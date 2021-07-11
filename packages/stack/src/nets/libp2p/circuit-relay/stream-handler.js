const { decode, encode } = require("it-length-prefixed");
const handshake = require("it-handshake");
const CircuitPB = require("./circuit-pb");

module.exports = class StreamHandler {
  /**
   * Create a stream handler for connection
   *
   * @param {object} options
   * @param {*} options.stream - A duplex iterable
   * @param {Number} options.maxLength - max bytes length of message
   */
  constructor({ stream, maxLength = 4096 }) {
    this.stream = stream;

    this.shake = handshake(this.stream);
    this.decoder = decode.fromReader(this.shake.reader, {
      maxDataLength: maxLength,
    });
  }

  /**
   * Read and decode message
   * @async
   * @returns {void}
   */
  async read() {
    const msg = await this.decoder.next();
    if (msg.value) {
      const value = CircuitPB.decode(msg.value.slice());
      return value;
    }

    // End the stream, we didn't get data
    this.close();
  }

  /**
   * Encode and write array of buffers
   *
   * @param {*} msg An unencoded CircuitRelay protobuf message
   */
  write(msg) {
    this.shake.write(encode.single(CircuitPB.encode(msg)));
  }

  /**
   * Return the handshake rest stream and invalidate handler
   *
   * @return {*} A duplex iterable
   */
  rest() {
    this.shake.rest();
    return this.shake.stream;
  }

  end(msg) {
    this.write(msg);
    this.close();
  }

  /**
   * Close the stream
   *
   * @returns {void}
   */
  close() {
    this.rest().sink([]);
  }
};
