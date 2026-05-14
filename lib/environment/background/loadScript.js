/* @flow */

import { apiToPromise } from '../utils/api';
import { addListener } from './messaging';

addListener('loadScript', async ({ url }, { tab: { id: tabId }, frameId }) => {
	await apiToPromise((...args) => chrome.scripting.executeScript(...args))({
		target: { tabId, frameIds: [frameId] },
		files: [url],
	});
});
