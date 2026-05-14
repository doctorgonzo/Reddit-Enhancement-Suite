/* @flow */

/**
 * Central selector map for Reddit's "shreddit" web component-based UI.
 *
 * Shreddit uses custom elements (<shreddit-post>, <shreddit-comment>, etc.)
 * with rich attributes instead of the class-based DOM that old Reddit (r2) uses.
 * All shreddit-specific selectors and attribute names are collected here so that
 * the rest of the codebase can import from a single source of truth.
 */

// Element tag names
export const SHREDDIT_POST: string = 'shreddit-post';
export const SHREDDIT_COMMENT: string = 'shreddit-comment';
export const SHREDDIT_APP: string = 'shreddit-app';
export const SHREDDIT_HEADER: string = 'reddit-header-large, reddit-header-action-items';

// Combined selector for all "thing"-like elements on shreddit
export const SHREDDIT_THING_SELECTOR: string = `${SHREDDIT_POST}, ${SHREDDIT_COMMENT}`;

// Main content container candidates (tried in order)
export const SHREDDIT_CONTENT_SELECTORS: string = 'shreddit-feed, main, shreddit-app';

// ---------- Attribute name maps ----------

// Attributes on <shreddit-post>
export const POST_ATTR = {
	author: 'author',
	score: 'score',
	title: 'post-title',
	permalink: 'permalink',
	subredditPrefixed: 'subreddit-prefixed-name',
	subreddit: 'subreddit-name',
	commentCount: 'comment-count',
	id: 'id', // fullname, e.g. "t3_xxxxx"
	domain: 'domain',
	postType: 'post-type', // e.g. "link", "self", "image", "video"
	isNsfw: 'is-nsfw',
	isSpoiler: 'is-spoiler',
	isLocked: 'is-locked',
	createdTimestamp: 'created-timestamp',
	upvoteRatio: 'upvote-ratio',
};

// Attributes on <shreddit-comment>
export const COMMENT_ATTR = {
	author: 'author',
	score: 'score',
	thingId: 'thing-id', // fullname, e.g. "t1_xxxxx"
	depth: 'depth',
	permalink: 'permalink',
	parentId: 'parent-id',
};

// ---------- Helpers ----------

export function isShredditElement(element: HTMLElement): boolean {
	const tag = element.tagName;
	return tag === 'SHREDDIT-POST' || tag === 'SHREDDIT-COMMENT';
}

export function isShredditPost(element: HTMLElement): boolean {
	return element.tagName === 'SHREDDIT-POST';
}

export function isShredditComment(element: HTMLElement): boolean {
	return element.tagName === 'SHREDDIT-COMMENT';
}
