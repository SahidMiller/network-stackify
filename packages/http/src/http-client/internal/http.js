"use strict";

module.exports = {
  kOutHeaders: Symbol("kOutHeaders"),
  kNeedDrain: Symbol("kNeedDrain"),
  utcDate: () => {
    return Date.prototype.toUTCString.call(new Date());
  },
};
