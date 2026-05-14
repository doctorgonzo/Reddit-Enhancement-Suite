/* @flow */

import { once } from 'lodash-es';
import { ajax } from '../environment';
import type { CurrentRedditUser, RedditAccount } from '../types/reddit';
import { MINUTE } from './time';
import { regexes } from './location';
import { isAppType } from './currentLocation';
import * as string from './string';

export const isLoggedIn = once(() => {
	if (loggedInUser()) {
		return true;
	} else if (document.querySelector('header a[href^="/message/inbox"]')) {
		return true;
	}
	// Shreddit: check for user-logged-in attribute on shreddit-app
	const shredditApp = document.querySelector('shreddit-app');
	if (shredditApp && shredditApp.hasAttribute('user-logged-in')) {
		return true;
	}
});

export const loggedInUser = once((): string | void => documentLoggedInUser(document));

export const documentLoggedInUser = (document: Document | Element): string | void => {
	if (isAppType('d2x')) {
		// Shreddit: check for user links or shreddit-app attribute
		const shredditApp = document.querySelector('shreddit-app');
		if (shredditApp) {
			// On shreddit, try to find the username from the page
			// User links in the header/nav area indicate who is logged in
			const userLink = document.querySelector('a[href*="/user/"][data-testid], header a[href*="/user/"], reddit-header-large a[href*="/user/"]');
			if (userLink && userLink instanceof HTMLAnchorElement) {
				const match = regexes.profile.exec(userLink.pathname);
				if (match) return match[1];
			}
			// Fallback: check any user link in the header area
			const headerUserLinks = document.querySelectorAll('a[href*="/user/"]');
			for (const link of headerUserLinks) {
				if (link instanceof HTMLAnchorElement) {
					const match = regexes.profile.exec(link.pathname);
					if (match) return match[1];
				}
			}
			// If shreddit-app doesn't have user-logged-in attribute, user isn't logged in
			if (!shredditApp.hasAttribute('user-logged-in')) return;
			return; // logged in but couldn't determine username
		}

		// Old d2x: The first text node in the user button contains the username
		const findFirstTextNode = e => [...e.childNodes].filter(v => v.nodeType === 3).concat(...[...e.children].map(findFirstTextNode));
		const button = document.querySelector('#USER_DROPDOWN_ID > *');
		const username = button && findFirstTextNode(button)[0];
		return username && username.textContent;
	}

	const link: ?HTMLAnchorElement = (document.querySelector('#header-bottom-right > span.user > a'): any);
	if (!link || link.classList.contains('login-required')) return;
	const profile = regexes.profile.exec(link.pathname);
	if (profile) {
		return profile[1];
	}
};

export const isModeratorAnywhere = once((): boolean => !!(document.getElementById('modmail') || document.querySelector('[href="/r/mod/"]')));

export const loggedInUserHash = once(async (): Promise<?string> => {
	const hashEle = document.querySelector('[name=uh]');
	if (hashEle instanceof HTMLInputElement) {
		return hashEle.value;
	}

	const userInfo = await loggedInUserInfo();
	return userInfo && userInfo.data && userInfo.data.modhash;
});

export const loggedInUserInfo = once((): Promise<CurrentRedditUser | void> =>
	!isLoggedIn() ? Promise.resolve() : ajax({ url: '/api/me.json', type: 'json' })
		.then(data => data.data && data.data.modhash ? data : undefined));

const usernameRE = /(?:u|user)\/([\w\-]{3,20}(?![\w\-]))/;

export const usernameSelector = [
	'.contents .author',
	'p.tagline a.author',
	'#friend-table span.user a',
	'.sidecontentbox .author',
	'div.md a[href^="/u/"]:not([href*="/m/"])',
	'div.md a[href*="reddit.com/u/"]:not([href*="/m/"])',
	'.usertable a.author',
	'.parent > a.author',
	'.usertable span.user a',
	'div.wiki-page-content .author',
	'.Post__authorLink', // Newish profile page
	// Shreddit selectors
	'a[href*="/user/"][data-testid*="author"]',
	'shreddit-post a[href*="/user/"]',
	'shreddit-comment a[href*="/user/"]',
].join(', ');

export function getUsernameFromLink(element: HTMLElement): ?string {
	if (!(element instanceof HTMLAnchorElement)) return;

	const { href, origin } = element;

	// The link should refer to this site
	if (!location.origin.endsWith(origin.split('.').slice(-2).join('.'))) return;

	const [, username] = href.match(usernameRE) || [];
	if (username) return username;
}

export function getUserInfo(username: ?string = loggedInUser()): Promise<RedditAccount> {
	if (!username) {
		return Promise.reject(new Error('getUserInfo: null/undefined username'));
	}

	return ajax({
		url: string.encode`/user/${username}/about.json`,
		type: 'json',
		cacheFor: 10 * MINUTE,
	});
}
