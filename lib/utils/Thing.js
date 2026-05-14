/* @flow */

import { memoize } from 'lodash-es';
import { filterMap } from './array';
import { throttleQueuePositionReset } from './async';
import { click, getPercentageVisibleYAxis, scrollToElement } from './dom';
import { downcast } from './flow';
import { currentSubreddit } from './currentLocation';
import { regexes } from './location';
import {
	SHREDDIT_THING_SELECTOR,
	SHREDDIT_CONTENT_SELECTORS,
	POST_ATTR,
	COMMENT_ATTR,
} from './shredditSelectors';

const elementMap = new WeakMap();
const things = new Set();
const SECRET_TOKEN = new class {}();

/**
 * Wrapper class around reddit's concept of a "Thing".
 * Use Thing.from or Thing.checkedFrom (fallible/infallible respectively) to construct a Thing.
 * Uniqueness is guaranteed, i.e. `Thing.from(element) === Thing.from(element)`.
 *
 * Supports both old Reddit (r2) `.thing` elements and new Reddit (shreddit)
 * `<shreddit-post>` / `<shreddit-comment>` web components.
 */
export class Thing {
	static thingSelector = `.thing, .search-result-link, ${SHREDDIT_THING_SELECTOR}`;
	static entrySelector = '.entry';

	// This query may be expensive and performed fairly often
	static thingElements = memoize((doc: ?HTMLElement = (
		document.body && (
			document.body.querySelector('.content[role="main"]') ||
			document.body.querySelector(SHREDDIT_CONTENT_SELECTORS) ||
			document.body
		)
	)): HTMLElement[] => (
		doc ? Array.from(doc.querySelectorAll(Thing.thingSelector)) : []
	));

	static things(doc: *): Thing[] {
		return Thing.thingElements(doc).map(e => Thing.checkedFrom(e));
	}

	static visibleThingElements(doc: *): HTMLElement[] {
		return Thing.thingElements(doc).filter(v => v.offsetParent);
	}

	static visibleThings(doc: *): Thing[] {
		return filterMap(Thing.visibleThingElements(doc), ele => {
			const thing = Thing.from(ele);
			if (thing) return [thing];
		});
	}

	element: HTMLElement;
	entry: HTMLElement;
	_isShreddit: boolean;

	parent: ?Thing;
	children = new Set();

	// Tasks are added and generally executed by watchers
	tasks: {| completed: boolean, visible: Array<() => any>, immediate: Array<() => any>, byId: Map<mixed, () => any> |} =
		{ completed: false, visible: [], immediate: [], byId: new Map() };

	static checkedFrom(element: HTMLElement | Thing): Thing {
		const thing = Thing.from(element);
		if (!thing) {
			throw new Error(`Could not construct Thing from ${String(element)}`);
		}
		return thing;
	}

	static from(element: ?HTMLElement | Thing): ?Thing {
		if (!element) return null;

		if (element instanceof Thing) return element;

		const thingElement = element.closest(Thing.thingSelector);
		if (!thingElement) return null;

		if (elementMap.has(thingElement)) return elementMap.get(thingElement);

		const isShreddit = thingElement.tagName === 'SHREDDIT-POST' || thingElement.tagName === 'SHREDDIT-COMMENT';

		const entry = thingElement.querySelector(Thing.entrySelector) || thingElement;
		// Don't add .entry class to shreddit web components — it could conflict with their own styles
		if (!isShreddit) entry.classList.add('entry');
		const thing = new Thing(SECRET_TOKEN, downcast(thingElement, HTMLElement), entry, isShreddit);

		Thing.thingElements.cache.clear();
		elementMap.set(thingElement, thing);
		things.add(thing);

		return thing;
	}

	constructor(token: typeof SECRET_TOKEN, thing: HTMLElement, entry: HTMLElement, isShreddit: boolean = false) {
		if (token !== SECRET_TOKEN) {
			throw new Error('Use Thing.from() or Thing.checkedFrom() instead of new Thing()');
		}

		this.element = thing;
		this.entry = entry;
		this._isShreddit = isShreddit;

		const _p = this.element.parentElement;
		if (isShreddit) {
			// On shreddit, parent comments are ancestor <shreddit-comment> elements
			this.parent = _p && Thing.from((_p: any).closest('shreddit-comment'));
		} else {
			this.parent = _p && Thing.from((_p: any).closest('.thing'));
		}
		if (this.parent) this.parent.children.add(this);
	}

	runTasks() {
		if (this.tasks.completed) return;
		this.tasks.completed = true;
		this.tasks.immediate.map(fn => fn());
		this.tasks.visible.map(fn => fn());
	}

	runSurroundingTasks(margin: number = 10) {
		const thingElements = Thing.thingElements();
		const idx = thingElements.indexOf(this.element);
		const min = Math.max(idx - margin, 0);
		const max = Math.min(idx + margin, thingElements.length - 1);
		for (let i = min; i <= max; i++) { // eslint-disable-line no-restricted-syntax
			const thing = Thing.checkedFrom(thingElements[i]);
			if (!thing.tasks.completed && thing.isVisible()) thing.runTasks();
		}
	}

	anchor() {
		// Keep the viewport anchored relative to this thing if it is in the viewport
		const anchor = getPercentageVisibleYAxis(this.entry) && { to: this.entry.getBoundingClientRect().top };
		if (!anchor) return;
		requestAnimationFrame(() => {
			if (!this.entry.offsetParent) return;
			scrollToElement(this.entry, undefined, { scrollStyle: 'none', anchor });
		});
	}

	setHideFilter(match: *) {
		this.element.classList.toggle('res-thing-filter-hide', !!match);

		if (this.isComment()) {
			this.refreshPartialVisibility();
			for (const p of this.getParents()) p.refreshPartialVisibility();
		}
	}

	setFilterReasons(elements: Array<HTMLElement>) {
		for (const old of this.element.querySelectorAll('.res-thing-filter-remove-matching-entry')) old.remove();
		this.element.prepend(...elements);
	}

	// `throttleQueuePositionReset` ensures that children will be evaluated first
	// Class is applied when a thing is hidden by a filter, but may have descendants that are not
	refreshPartialVisibility = throttleQueuePositionReset(() => {
		this.element.classList.toggle('res-thing-partial', this.isHiddenByFilter(true) && (
			// Comment has unloaded comments whose state is still not known
			// TODO If clicking this causes the comment to disappear, notify!
			this.element.matches('.morerecursion, .morechildren') ||
			// Comment has unfilter children
			Array.from(this.children).some(v => !v.isHiddenByFilter())
		));
	});

	getDirectionOf(other: Thing): ?('down' | 'up') {
		if (!this.isVisible() || !other.isVisible()) return;
		return (other.entry.compareDocumentPosition(this.entry) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'up' : 'down';
	}

	getThreadTop(): Thing {
		let thing = this; // eslint-disable-line consistent-this

		let current = this.element;
		while ((current = current.parentElement)) {
			if (current.matches(Thing.thingSelector)) thing = downcast(current, HTMLElement);
		}

		return Thing.checkedFrom(thing);
	}

	getParents(): Thing[] {
		const parents = [];
		let level = this; // eslint-disable-line consistent-this
		while ((level = level.parent)) parents.push(level);
		return parents;
	}

	getNext({ direction = 'down', excludeMoreChildren = false }: {| direction?: 'up' | 'down', excludeMoreChildren?: boolean |} = {}, things: HTMLElement[] = Thing.thingElements()): ?Thing {
		let index = things.indexOf(this.element);
		let target;

		do {
			index += direction === 'down' ? 1 : -1;
			const _target = things[index];
			target = _target;
			if (!target) return null;
			if (excludeMoreChildren && target.matches('.morechildren')) continue;
		} while (!target.offsetParent);

		return Thing.from(target);
	}

	getNextSibling(options: *): ?Thing {
		if (!this.element.parentElement) return null;

		const things = Array.from(this.element.parentElement.children)
			.filter(e => e.matches(Thing.thingSelector));

		return this.getNext(options, things);
	}

	getClosest(func: (...args: any) => ?Thing, ...args: mixed[]): ?Thing {
		const target = Reflect.apply(func, this, args);
		if (target) {
			return target;
		} else {
			if (this.parent) return this.parent.getClosest(func, ...args);
		}
	}

	getClosestVisible(options: * = { excludeMoreChildren: true }): ?Thing {
		if (this.element.offsetParent) return this;
		return this.getNext({ direction: 'down', ...options }) || this.getNext({ direction: 'up', ...options });
	}

	// ---- Type identification ----

	isMessage(): boolean {
		if (this._isShreddit) return false;
		return this.element.classList.contains('message');
	}

	isSubreddit(): boolean {
		if (this._isShreddit) return false;
		return this.element.classList.contains('subreddit');
	}

	isPost(): boolean {
		if (this._isShreddit) return this.element.tagName === 'SHREDDIT-POST';
		return this.element.classList.contains('link') || this.element.classList.contains('search-result-link');
	}

	isLinkPost(): boolean {
		if (!this.isPost()) return false;
		if (this._isShreddit) {
			const postType = this.element.getAttribute(POST_ATTR.postType);
			return postType === 'link';
		}
		if (this.element.classList.contains('search-result-link')) {
			return !this.element.querySelector('a').classList.contains('self');
		} else {
			return !this.element.classList.contains('self');
		}
	}

	isSelfPost(): boolean {
		if (!this.isPost()) return false;
		if (this._isShreddit) {
			const postType = this.element.getAttribute(POST_ATTR.postType);
			return postType === 'self';
		}
		if (this.element.classList.contains('search-result-link')) {
			return this.element.querySelector('a').classList.contains('self');
		} else {
			return this.element.classList.contains('self');
		}
	}

	isComment(): boolean {
		if (this._isShreddit) return this.element.tagName === 'SHREDDIT-COMMENT';
		return this.element.classList.contains('comment') || this.element.classList.contains('was-comment');
	}

	isTopLevelComment(): boolean {
		if (this._isShreddit) {
			if (!this.isComment()) return false;
			const depth = this.element.getAttribute(COMMENT_ATTR.depth);
			return depth === '0' || !this.parent;
		}
		return this.isComment() && !!this.element.parentElement && this.element.parentElement.classList.contains('nestedlisting');
	}

	// ---- Data getters ----

	getTitle(): string {
		if (this._isShreddit) {
			return this.element.getAttribute(POST_ATTR.title) || '';
		}
		const element = this.getTitleElement();
		return element && element.textContent || '';
	}

	getTitleElement(): ?HTMLAnchorElement {
		if (this._isShreddit) {
			// Try to find the rendered title link inside the shreddit element
			return (this.element.querySelector('a[slot="title"], a[data-testid="post-title"], [slot="title"] a, a.title'): any);
		}
		return (this.entry.querySelector('a.title, a.search-title') ||
			this.entry.querySelector('.title'): any);
	}

	getTitleUrl(): string {
		if (this._isShreddit) {
			return this.element.getAttribute(POST_ATTR.permalink) || '';
		}
		const element = this.getTitleElement();
		if (element) {
			return element.href;
		}
		return '';
	}

	getPostLink(): HTMLAnchorElement {
		if (this._isShreddit) {
			const link = this.element.querySelector('a[slot="title"], a[data-testid="post-title"], [slot="title"] a, a.title');
			return downcast(link, HTMLAnchorElement);
		}
		const element = this.entry.querySelector('a.title, a.search-link') || this.entry.querySelector('a.search-title');
		// Text posts on search don't have title/search-link class
		return downcast(element, HTMLAnchorElement);
	}

	getPostUrl(): string {
		if (this._isShreddit) {
			return this.element.getAttribute(POST_ATTR.permalink) || '';
		}
		return this.element.dataset.url || this.getPostLink().href;
	}

	getTextBody(): HTMLElement {
		if (this._isShreddit) {
			return this.element.querySelector('[slot="text-body"], .md, [data-testid="post-text-body"]');
		}
		return this.entry.querySelector('.md');
	}

	getCommentsLink(): ?HTMLAnchorElement {
		if (this._isShreddit) {
			const permalink = this.element.getAttribute(POST_ATTR.permalink);
			if (permalink) {
				// Try to find an anchor link to comments
				const link = this.element.querySelector('a[href*="/comments/"]');
				return link instanceof HTMLAnchorElement ? link : undefined;
			}
			return undefined;
		}
		const a = this.entry.querySelector('a.comments, a.search-comments');
		return a instanceof HTMLAnchorElement ? a : undefined;
	}

	getCommentPermalink(): ?HTMLAnchorElement {
		if (this._isShreddit) {
			const permalink = this.element.getAttribute(COMMENT_ATTR.permalink) || this.element.getAttribute(POST_ATTR.permalink);
			if (permalink) {
				const link = this.element.querySelector(`a[href="${permalink}"], a[href*="/comment/"]`);
				return link instanceof HTMLAnchorElement ? link : undefined;
			}
			return undefined;
		}
		return (this.entry.querySelector('a.bylink'): any);
	}

	getHideElement(): ?HTMLAnchorElement {
		if (this._isShreddit) return null;
		return (this.entry.querySelector('.hide-button a, .unhide-button a'): any);
	}

	getButtons(): HTMLAnchorElement {
		if (this._isShreddit) {
			// Shreddit uses a different action bar structure
			return (this.element.querySelector('shreddit-post-overflow-menu, [slot="action-bar"], .action-bar'): any);
		}
		return (this.entry.querySelector('.flat-list.buttons'): any);
	}

	getNumberOfChildren(): number {
		if (this._isShreddit) {
			const count = this.element.getAttribute(POST_ATTR.commentCount);
			return count ? parseInt(count, 10) || 0 : 0;
		}
		// Parse the text, since all children elements may not be loaded
		const numChildrenElem = this.entry.querySelector('.numchildren');
		const match = numChildrenElem && (/(\d+)/).exec(numChildrenElem.textContent);
		return match && parseInt(match[1], 10) || 0;
	}

	static _parseScore(scoreEle: HTMLElement): number {
		return parseInt(scoreEle.title || scoreEle.textContent, 10) || 0;
	}

	getScore(): ?number {
		if (this._isShreddit) {
			const score = this.element.getAttribute(this.isPost() ? POST_ATTR.score : COMMENT_ATTR.score);
			return score != null ? parseInt(score, 10) || 0 : null;
		}
		if (!isNaN(this.element.dataset.score)) {
			return parseInt(this.element.dataset.score, 10);
		}

		const element = this._getActiveScoreElement();
		// parseInt() strips off the ' points' from comments
		return element && Thing._parseScore(element);
	}

	_getActiveScoreElement(): ?HTMLElement {
		if (this._isShreddit) return null;
		if (this.isPost()) {
			return this.element.querySelector([
				'.midcol.unvoted > .score.unvoted',
				'.midcol.likes > .score.likes',
				'.midcol.dislikes > .score.dislikes',
				'.search-score',
			].join(', '));
		} else { // if (this.isComment()) {
			return this.entry.querySelector('.tagline > .score');
		}
	}

	getAllScoreElements(): Array<[HTMLElement, number]> {
		if (this._isShreddit) return [];
		const toScoreTuple = ele => [ele, Thing._parseScore(ele)];
		if (this.isPost()) {
			return Array.from(this.element.querySelectorAll('.midcol > .score, .search-score')).map(toScoreTuple);
		} else { // if (this.isComment()) {
			return Array.from(this.entry.querySelectorAll('.tagline > .score')).map(toScoreTuple);
		}
	}

	getAuthor(): ?string {
		if (this._isShreddit) {
			return this.element.getAttribute(POST_ATTR.author) || this.element.getAttribute(COMMENT_ATTR.author) || undefined;
		}
		const data = this.element.getAttribute('data-author');
		if (data) {
			return data;
		}
		const element = this.getAuthorElement();
		if (element) {
			const match = regexes.profile.exec(element.pathname);
			if (match) {
				return match[1];
			}
		}
	}

	getAuthorUrl(): string {
		const author = this.getAuthor();
		if (author) {
			return `/user/${author}/`;
		}
		return '';
	}

	getAuthorElement(): ?HTMLAnchorElement {
		if (this._isShreddit) {
			// Try to find the rendered author link
			return (this.element.querySelector('a[href*="/user/"][data-testid*="author"], a[href*="/user/"].author, [slot="authorName"] a'): any);
		}
		return (this.entry.querySelector('.tagline a.author, .search-author .author'): any);
	}

	getSubreddit(): ?string {
		if (this._isShreddit) {
			// Try prefixed name first (e.g. "r/AskReddit"), strip the prefix
			let sub = this.element.getAttribute(POST_ATTR.subredditPrefixed);
			if (sub) {
				if (sub.startsWith('r/')) sub = sub.slice(2);
				return sub;
			}
			// Fall back to non-prefixed name
			sub = this.element.getAttribute(POST_ATTR.subreddit);
			if (sub) return sub;
			return currentSubreddit();
		}
		const data = this.element.getAttribute('data-subreddit');
		if (data) {
			return data;
		}
		const element = this.getSubredditLink();
		if (element) {
			const match = regexes.subreddit.exec(element.pathname);
			if (match) {
				return match[1];
			}
		} else {
			return currentSubreddit();
		}
	}

	getSubredditLink(): ?HTMLAnchorElement {
		if (this._isShreddit) {
			return (this.element.querySelector('a[href*="/r/"][data-testid*="subreddit"], a[href*="/r/"].subreddit'): any);
		}
		if (this.isPost()) {
			return (this.entry.querySelector('.tagline a.subreddit, a.search-subreddit-link'): any);
		} else if (this.isComment()) {
			// TODO: does .parent a.subreddit work?
			return (this.entry.querySelector('.parent a.subreddit, .tagline .subreddit a'): any);
		}
	}

	getPostDomain(): string {
		if (this._isShreddit) {
			const domain = this.element.getAttribute(POST_ATTR.domain);
			if (domain) return domain;
			const subreddit = this.getSubreddit();
			if (subreddit) return `self.${subreddit}`;
			return 'reddit.com';
		}
		const data = this.element.getAttribute('data-domain');
		if (data) {
			return data;
		}

		const element = this.getPostDomainLink();
		if (element) {
			return element.textContent;
		}

		const text = this.getPostDomainText();
		if (text) {
			return text;
		}

		const subreddit = this.getSubreddit();
		if (subreddit) {
			return `self.${subreddit}`;
		}

		return 'reddit.com';
	}

	getPostDomainUrl(): string {
		if (this._isShreddit) {
			return `/domain/${this.getPostDomain()}/`;
		}
		const link = this.getPostDomainLink();
		if (link) {
			return link.href;
		}
		return `/domain/${this.getPostDomain()}/`;
	}

	getPostDomainLink(): ?HTMLAnchorElement {
		if (this._isShreddit) return null;
		return (this.entry.querySelector('.domain a'): any);
	}

	getPostDomainText(): string {
		if (this._isShreddit) {
			return this.element.getAttribute(POST_ATTR.domain) || '';
		}
		const data = this.element.getAttribute('data-domain');
		if (data) {
			return data;
		}

		const element = this.element.querySelector('.domain');
		if (!element) return '';
		const text = element.textContent || '';
		return text.replace(/[\(\)\s]/g, '');
	}

	getCommentCount(): ?number {
		if (this._isShreddit) {
			const count = this.element.getAttribute(POST_ATTR.commentCount);
			return count != null ? parseInt(count, 10) || 0 : undefined;
		}
		const element = this.getCommentCountElement();
		if (!element) return;
		return parseInt((/\d+/).exec(
			element.getAttribute('data-text') || // In case noCtrlF is applied
			element.textContent,
		), 10) || 0;
	}

	getCommentCountElement(): ?HTMLElement {
		if (this._isShreddit) {
			// Try to find the rendered comment count element
			return this.element.querySelector('[data-testid="comment-count"], a[href*="/comments/"]');
		}
		if (this.isPost()) {
			return this.entry.querySelector('.buttons .comments');
		} else if (this.isComment()) {
			return this.entry.querySelector('.buttons a.full-comments');
		}
	}

	getPostThumbnailUrl(): string {
		if (this._isShreddit) {
			const thumb = this.element.querySelector('img[src*="thumb"], img[alt="Post image"], [slot="thumbnail"] img');
			return thumb instanceof HTMLImageElement ? thumb.src : '';
		}
		const thumbnail = this.getPostThumbnailElement();
		if (!thumbnail) return '';
		return thumbnail.src || '';
	}

	getPostThumbnailElement(): ?HTMLImageElement {
		if (this._isShreddit) {
			return (this.element.querySelector('img[src*="thumb"], img[alt="Post image"], [slot="thumbnail"] img'): any);
		}
		return (this.element.querySelector('.thumbnail img'): any);
	}

	getPostFlairText(): string {
		if (this._isShreddit) {
			const flair = this.element.querySelector('faceplate-tracker[noun="flair"], [slot="flair"] span, span.flair');
			return flair ? flair.textContent.trim() : '';
		}
		const element = this.getPostFlairElement();
		return element && element.textContent || '';
	}

	getPostFlairElement(): ?HTMLElement {
		if (this._isShreddit) {
			return this.element.querySelector('faceplate-tracker[noun="flair"], [slot="flair"], span.flair');
		}
		return this.entry.querySelector('.title > .linkflairlabel');
	}

	getUserFlairText(): string {
		if (this._isShreddit) {
			const flair = this.element.querySelector('faceplate-tracker[noun="user_flair"], [slot="user-flair"]');
			return flair ? flair.textContent.trim() : '';
		}
		const element = this.getUserFlairElement();
		return element && element.textContent || '';
	}

	getUserFlairElement(): ?HTMLElement {
		if (this._isShreddit) {
			return this.element.querySelector('faceplate-tracker[noun="user_flair"], [slot="user-flair"]');
		}
		return this.entry.querySelector('.tagline > .flair');
	}

	getCrosspostBadgeElement(): ?HTMLElement {
		if (this._isShreddit) return null;
		return this.entry.querySelector('.crosspost-badge');
	}

	getUpvoteButton(): ?HTMLElement {
		if (this._isShreddit) {
			return this.element.querySelector('button[upvote], shreddit-post-share-button ~ button:first-of-type, [aria-label="upvote"], [data-click-id="upvote"]');
		}
		return this._getVoteButton('div.up, div.upmod');
	}

	getDownvoteButton(): ?HTMLElement {
		if (this._isShreddit) {
			return this.element.querySelector('button[downvote], [aria-label="downvote"], [data-click-id="downvote"]');
		}
		return this._getVoteButton('div.down, div.downmod');
	}

	_getVoteButton(selector: string): ?HTMLElement {
		const previousSibling: HTMLElement = (this.entry.previousSibling: any);
		if (previousSibling.tagName === 'A') {
			return (previousSibling.previousSibling: any).querySelector(selector);
		} else {
			return previousSibling.querySelector(selector);
		}
	}

	getTimestamp(): ?Date {
		if (this._isShreddit) {
			const ts = this.element.getAttribute(POST_ATTR.createdTimestamp);
			if (ts) return new Date(ts);
			return null;
		}
		const element = this.getTimestampElement();
		return element && new Date(element.getAttribute('datetime'));
	}

	getTimestampElement(): ?HTMLElement {
		if (this._isShreddit) {
			return this.element.querySelector('time, faceplate-timeago');
		}
		return this.entry.querySelector('time');
	}

	getPostEditTimestamp(): number {
		if (this._isShreddit) return 0;
		const element = this.getPostEditTimestampElement();
		return element && (Date.parse(element.getAttribute('datetime')) / 1000) || 0;
	}

	getPostEditTimestampElement(): ?HTMLElement {
		if (this._isShreddit) return null;
		return this.entry.querySelector('time.edited-timestamp');
	}

	getFullname(): string {
		if (this._isShreddit) {
			if (this.isPost()) {
				return this.element.getAttribute(POST_ATTR.id) || '';
			} else if (this.isComment()) {
				return this.element.getAttribute(COMMENT_ATTR.thingId) || this.element.getAttribute('id') || '';
			}
			return '';
		}
		return this.element.getAttribute('data-fullname') || '';
	}

	getUserattrsElement(): ?HTMLElement {
		if (this._isShreddit) return null;
		return this.entry.querySelector('.userattrs');
	}

	getRank(): ?number {
		if (this._isShreddit) return undefined;
		const rank = parseInt(this.element.getAttribute('data-rank'), 10);
		if (!isNaN(rank)) return rank;
	}

	getRankElement(): ?HTMLElement {
		if (this._isShreddit) return null;
		if (!this.isPost()) return;
		return this.element.querySelector('.rank');
	}

	getTaglineElement(): ?HTMLElement {
		if (this._isShreddit) {
			// Shreddit doesn't have a tagline per se, but the author/meta area serves a similar purpose
			return this.element.querySelector('[slot="credit-bar"], [data-testid="post-credit-bar"]');
		}
		return this.entry.querySelector('.tagline');
	}

	getCommentCollapseToggleElement(): ?HTMLElement {
		if (this._isShreddit) {
			return this.element.querySelector('button[aria-label*="collapse"], button[aria-label*="Toggle"], details > summary');
		}
		return this.entry.querySelector('.expand');
	}

	setCommentCollapse(state: boolean, reason: string, openOnlyWhenSameReason: boolean = false): ?HTMLElement {
		const toggle = this.getCommentCollapseToggleElement();
		if (!toggle) return;
		if (state) toggle.setAttribute('collapse-reason', reason);
		if (this.isCollapsed() === state) return;
		if (!state && openOnlyWhenSameReason && toggle.getAttribute('collapse-reason') !== reason) return;
		if (!state) toggle.removeAttribute('collapse-reason');
		click(toggle); // Simulate a click, so that the event bubbles
	}

	getPostTime(): string {
		if (this._isShreddit) {
			const ts = this.element.getAttribute(POST_ATTR.createdTimestamp);
			if (ts) {
				const el = this.element.querySelector('time, faceplate-timeago');
				return el ? el.textContent : new Date(ts).toLocaleString();
			}
			return '';
		}
		const element = this.getPostTimeElement();
		if (element) {
			return element.textContent;
		}
		return '';
	}

	getPostTimeElement(): ?HTMLElement {
		if (this._isShreddit) {
			return this.element.querySelector('time, faceplate-timeago');
		}
		return this.entry.querySelector('.tagline time');
	}

	// ---- Boolean flags ----

	isNSFW(): boolean {
		if (this._isShreddit) {
			return this.element.hasAttribute(POST_ATTR.isNsfw) && this.element.getAttribute(POST_ATTR.isNsfw) !== 'false';
		}
		return this.element.classList.contains('over18') || !!this.entry.querySelector('.nsfw-stamp');
	}

	isSpoiler(): boolean {
		if (this._isShreddit) {
			return this.element.hasAttribute(POST_ATTR.isSpoiler) && this.element.getAttribute(POST_ATTR.isSpoiler) !== 'false';
		}
		if (this.element.classList.contains('search-result')) {
			return !!this.entry.querySelector('.spoiler-stamp');
		}
		return this.element.classList.contains('spoiler');
	}

	isCrosspost(): boolean {
		if (this._isShreddit) return false; // TODO: detect crossposts on shreddit
		return !!this.getCrosspostBadgeElement();
	}

	isLocked(): boolean {
		if (this._isShreddit) {
			return this.element.hasAttribute(POST_ATTR.isLocked) && this.element.getAttribute(POST_ATTR.isLocked) !== 'false';
		}
		if (this.element.classList.contains('search-result')) {
			return this.element.classList.contains('linkflair-locked');
		}
		return this.element.classList.contains('locked');
	}

	isDeleted(): boolean {
		if (this._isShreddit) {
			const author = this.getAuthor();
			return author === '[deleted]' || author === undefined;
		}
		return this.element.classList.contains('deleted');
	}

	isHiddenByFilter(partialAsFiltered: boolean = false): boolean {
		// Keep in sync with the CSS rules
		if (!this._isShreddit && this.element.matches('body.hideOver18 .over18:not(.allowOver18)')) return true;
		if (!this.element.classList.contains('res-thing-filter-hide')) return false;
		if (this.element.classList.contains('res-filterline-highlight-match')) return false;
		if (partialAsFiltered) {
			if (this.element.classList.contains('res-thing-partial') && this.element.classList.contains('res-selected')) return false;
			return true;
		} else {
			if (this.element.classList.contains('res-thing-hide-children')) return true;
			return !this.element.classList.contains('res-thing-partial');
		}
	}

	isCollapsed(): boolean {
		if (this._isShreddit) {
			// Shreddit comments may use a 'collapsed' attribute or class
			return this.element.hasAttribute('collapsed') ||
				this.element.classList.contains('collapsed') ||
				this.element.getAttribute('aria-expanded') === 'false';
		}
		return this.element.classList.contains('collapsed');
	}

	// Should be equivalent to `this.element.offsetParent !== null`
	isVisible(): boolean {
		// Promoted (ads) are often hidden by adblockers, so just assume that they're not visible
		if (!this._isShreddit && this.element.classList.contains('promoted')) return false;

		if (!document.body.classList.contains('res-filters-disabled') && this.isHiddenByFilter()) return false;
		const { parent } = this;
		if (parent) {
			if (parent.isCollapsed()) return false;
			if (parent.element.classList.contains('res-children-hidden')) return false; // `hideChildComments` module
			if (!parent.isVisible()) return false;
		}

		return true;
	}

	isContentVisible(): boolean {
		return !(
			this.element.classList.contains('res-thing-has-placeholder') ||
			(!document.body.classList.contains('res-filters-disabled') && this.isHiddenByFilter(true)) ||
			this.isCollapsed() ||
			!this.isVisible()
		);
	}

	isSelected() {
		return this.element.classList.contains('res-selected');
	}

	isUpvoted() {
		if (this._isShreddit) {
			// Check for upvote state via attribute or button state
			const upvote = this.getUpvoteButton();
			return upvote ? upvote.getAttribute('aria-pressed') === 'true' || upvote.classList.contains('upmod') : false;
		}
		return this.entry.classList.contains('likes');
	}

	isDownvoted() {
		if (this._isShreddit) {
			const downvote = this.getDownvoteButton();
			return downvote ? downvote.getAttribute('aria-pressed') === 'true' || downvote.classList.contains('downmod') : false;
		}
		return this.entry.classList.contains('dislikes');
	}

	isUnvoted() {
		if (this._isShreddit) {
			return !this.isUpvoted() && !this.isDownvoted();
		}
		return this.entry.classList.contains('unvoted');
	}
}

if (process.env.NODE_ENV === 'development') {
	// for debugging only! do not use `getThingIsVisibleInconsistencies` in any committed code
	window.getThingIsVisibleInconsistencies = () => Array.from(things).filter(v => v.isVisible() === !v.element.offsetParent);
}
