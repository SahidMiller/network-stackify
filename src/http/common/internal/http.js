"use strict";

export const kOutHeaders = Symbol("kOutHeaders");
export const kNeedDrain = Symbol("kNeedDrain");
export function utcDate() {
  return Date.prototype.toUTCString.call(new Date());
}
