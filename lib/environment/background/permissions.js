/* @flow */

import { apiToPromise } from '../utils/api';
import { addListener } from './messaging';

addListener('permissions', handleMessage);

export function handleMessage({ operation, permissions, origins }: *) {
	switch (operation) {
		case 'contains':
			return apiToPromise((...args) => chrome.permissions.contains(...args))({ permissions, origins });
		case 'request':
			return apiToPromise((...args) => chrome.permissions.request(...args))({ permissions, origins })
				.catch(() => makePromptWindow({ permissions, origins }));
		default:
			throw new Error(`Invalid permissions operation: ${operation}`);
	}
}

async function makePromptWindow({ permissions, origins }) {
	const url = new URL('prompt.html', location.origin);
	url.searchParams.set('permissions', JSON.stringify(permissions));
	url.searchParams.set('origins', JSON.stringify(origins));

	const width = 630;
	const height = 255;

	// Get the current window's dimensions and calculate center position
	const { width: screenWidth, height: screenHeight } = await chrome.windows.getCurrent() || { width: 1920, height: 1080 };
	const left = Math.floor(screenWidth / 2 - width / 2);
	const top = Math.floor(screenHeight / 2 - height / 2);

	const { tabs: [{ id }] } = await apiToPromise((...args) => chrome.windows.create(...args))({ url: url.href, type: 'popup', width, height, left, top });

	return new Promise(resolve => {
		function updateListener(tabId, updates) {
			if (tabId !== id) return;

			const url = updates.url && new URL(updates.url);
			if (url && url.searchParams.has('result')) {
				stopListening();
				const result = url.searchParams.get('result');
				if (!result) return;
				resolve(JSON.parse(result));
				apiToPromise((...args) => chrome.tabs.remove(...args))(id);
			}
		}

		function removeListener(tabId) {
			if (tabId !== id) return;
			stopListening();
			resolve(false);
		}

		function stopListening() {
			chrome.tabs.onUpdated.removeListener(updateListener);
			chrome.tabs.onRemoved.removeListener(removeListener);
		}

		chrome.tabs.onUpdated.addListener(updateListener);
		chrome.tabs.onRemoved.addListener(removeListener);
	});
}
