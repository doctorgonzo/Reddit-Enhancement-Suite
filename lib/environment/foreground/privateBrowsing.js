/* @flow */

export function isPrivateBrowsing(): boolean {
	return typeof chrome !== 'undefined' && chrome.extension && chrome.extension.inIncognitoContext || false;
}
