/* @flow */

/**
 * Content watcher for Reddit's "shreddit" web component-based UI.
 *
 * Uses a MutationObserver to watch for <shreddit-post> and <shreddit-comment>
 * elements being added to the DOM, then registers them through the standard
 * Thing / watcher pipeline so that all existing RES modules receive callbacks.
 *
 * Also sets up an IntersectionObserver for visibility-based task execution,
 * mirroring the behavior of the r2 watcher for old Reddit.
 */

import { Thing } from './Thing';
import { registerPage } from './watchers';
import { isAppType } from './currentLocation';
import { SHREDDIT_THING_SELECTOR } from './shredditSelectors';

export function initShredditWatcher() {
	// Only run on d2x (shreddit) pages
	if (!isAppType('d2x')) return;

	// IntersectionObserver for visibility-based task execution
	// Tasks registered as non-immediate only run when the thing scrolls into view
	const io = new IntersectionObserver(entries => {
		for (const { target, isIntersecting } of entries) {
			if (isIntersecting) {
				io.unobserve(target);
				const thing = Thing.from(target);
				if (thing) thing.runTasks();
			}
		}
	}, { rootMargin: '100%' });

	const processShredditElement = (el: HTMLElement) => {
		// registerPage -> registerThing -> runs immediate watchers
		registerPage(el);

		// Queue non-immediate tasks to run when the element becomes visible
		const thing = Thing.from(el);
		if (thing && !thing.tasks.completed) {
			io.observe(thing.element);
		}
	};

	// Watch for future shreddit elements being added to the DOM
	const observer = new MutationObserver(mutations => {
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (node.nodeType !== Node.ELEMENT_NODE) continue;
				const el: HTMLElement = (node: any);

				// Check if the added node itself is a shreddit thing
				if (el.matches && el.matches(SHREDDIT_THING_SELECTOR)) {
					processShredditElement(el);
				}

				// Check descendants of the added node
				if (el.querySelectorAll) {
					const descendants = el.querySelectorAll(SHREDDIT_THING_SELECTOR);
					for (const desc of descendants) {
						processShredditElement(desc);
					}
				}
			}
		}
	});

	observer.observe(document.body, { childList: true, subtree: true });

	// Process any shreddit elements already in the DOM
	const existing = document.querySelectorAll(SHREDDIT_THING_SELECTOR);
	for (const el of existing) {
		processShredditElement(el);
	}
}
