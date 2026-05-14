/* @flow */

import { createMessageHandler } from '../utils/messaging';
import { apiToPromise } from '../utils/api';

const _sendMessage = apiToPromise((...args) => chrome.runtime.sendMessage(...args));

const {
	_handleMessage,
	sendMessage,
	addListener,
} = createMessageHandler(obj => _sendMessage(obj));

chrome.runtime.onMessage.addListener((obj, sender, sendResponse) => _handleMessage(obj, sendResponse));

export {
	sendMessage,
	addListener,
};
