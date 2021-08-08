import { codes } from "./errors.js";

const { ERR_OUT_OF_RANGE } = codes;
import { validateNumber } from "./validators.js";

// Timeout values > TIMEOUT_MAX are set to 1.
const TIMEOUT_MAX = 2 ** 31 - 1;

// Type checking used by timers.enroll() and Socket#setTimeout()
export function getTimerDuration(msecs, name) {
  validateNumber(msecs, name);
  if (msecs < 0 || !Number.isFinite(msecs)) {
    throw new ERR_OUT_OF_RANGE(name, "a non-negative finite number", msecs);
  }

  // Ensure that msecs fits into signed int32
  if (msecs > TIMEOUT_MAX) {
    console.log(
      `${msecs} does not fit into a 32-bit signed integer.` +
        `\nTimer duration was truncated to ${TIMEOUT_MAX}.`,
      "TimeoutOverflowWarning"
    );
    return TIMEOUT_MAX;
  }

  return msecs;
}
