/* An expensive regular expression runs only in this terminable worker. */
'use strict';
importScripts('core-writing.js');
self.onmessage = ({ data }) => self.postMessage(FDCoreWriting.runSearchTask(data));
