"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/constants.js
var require_constants = __commonJS({
  "node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/constants.js"(exports2, module2) {
    "use strict";
    var BINARY_TYPES = ["nodebuffer", "arraybuffer", "fragments"];
    var hasBlob = typeof Blob !== "undefined";
    if (hasBlob)
      BINARY_TYPES.push("blob");
    module2.exports = {
      BINARY_TYPES,
      CLOSE_TIMEOUT: 3e4,
      EMPTY_BUFFER: Buffer.alloc(0),
      GUID: "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
      hasBlob,
      kForOnEventAttribute: Symbol("kIsForOnEventAttribute"),
      kListener: Symbol("kListener"),
      kStatusCode: Symbol("status-code"),
      kWebSocket: Symbol("websocket"),
      NOOP: () => {
      }
    };
  }
});

// node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/buffer-util.js
var require_buffer_util = __commonJS({
  "node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/buffer-util.js"(exports2, module2) {
    "use strict";
    var { EMPTY_BUFFER } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    function concat(list, totalLength) {
      if (list.length === 0)
        return EMPTY_BUFFER;
      if (list.length === 1)
        return list[0];
      const target = Buffer.allocUnsafe(totalLength);
      let offset = 0;
      for (let i = 0; i < list.length; i++) {
        const buf = list[i];
        target.set(buf, offset);
        offset += buf.length;
      }
      if (offset < totalLength) {
        return new FastBuffer(target.buffer, target.byteOffset, offset);
      }
      return target;
    }
    function _mask(source, mask, output2, offset, length) {
      for (let i = 0; i < length; i++) {
        output2[offset + i] = source[i] ^ mask[i & 3];
      }
    }
    function _unmask(buffer, mask) {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= mask[i & 3];
      }
    }
    function toArrayBuffer(buf) {
      if (buf.length === buf.buffer.byteLength) {
        return buf.buffer;
      }
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
    }
    function toBuffer(data) {
      toBuffer.readOnly = true;
      if (Buffer.isBuffer(data))
        return data;
      let buf;
      if (data instanceof ArrayBuffer) {
        buf = new FastBuffer(data);
      } else if (ArrayBuffer.isView(data)) {
        buf = new FastBuffer(data.buffer, data.byteOffset, data.byteLength);
      } else {
        buf = Buffer.from(data);
        toBuffer.readOnly = false;
      }
      return buf;
    }
    module2.exports = {
      concat,
      mask: _mask,
      toArrayBuffer,
      toBuffer,
      unmask: _unmask
    };
    if (!process.env.WS_NO_BUFFER_UTIL) {
      try {
        const bufferUtil = require("bufferutil");
        module2.exports.mask = function(source, mask, output2, offset, length) {
          if (length < 48)
            _mask(source, mask, output2, offset, length);
          else
            bufferUtil.mask(source, mask, output2, offset, length);
        };
        module2.exports.unmask = function(buffer, mask) {
          if (buffer.length < 32)
            _unmask(buffer, mask);
          else
            bufferUtil.unmask(buffer, mask);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/limiter.js
var require_limiter = __commonJS({
  "node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/limiter.js"(exports2, module2) {
    "use strict";
    var kDone = Symbol("kDone");
    var kRun = Symbol("kRun");
    var Limiter = class {
      /**
       * Creates a new `Limiter`.
       *
       * @param {Number} [concurrency=Infinity] The maximum number of jobs allowed
       *     to run concurrently
       */
      constructor(concurrency) {
        this[kDone] = () => {
          this.pending--;
          this[kRun]();
        };
        this.concurrency = concurrency || Infinity;
        this.jobs = [];
        this.pending = 0;
      }
      /**
       * Adds a job to the queue.
       *
       * @param {Function} job The job to run
       * @public
       */
      add(job) {
        this.jobs.push(job);
        this[kRun]();
      }
      /**
       * Removes a job from the queue and runs it if possible.
       *
       * @private
       */
      [kRun]() {
        if (this.pending === this.concurrency)
          return;
        if (this.jobs.length) {
          const job = this.jobs.shift();
          this.pending++;
          job(this[kDone]);
        }
      }
    };
    module2.exports = Limiter;
  }
});

// node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/permessage-deflate.js
var require_permessage_deflate = __commonJS({
  "node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/permessage-deflate.js"(exports2, module2) {
    "use strict";
    var zlib = require("zlib");
    var bufferUtil = require_buffer_util();
    var Limiter = require_limiter();
    var { kStatusCode } = require_constants();
    var FastBuffer = Buffer[Symbol.species];
    var TRAILER = Buffer.from([0, 0, 255, 255]);
    var kPerMessageDeflate = Symbol("permessage-deflate");
    var kTotalLength = Symbol("total-length");
    var kCallback = Symbol("callback");
    var kBuffers = Symbol("buffers");
    var kError = Symbol("error");
    var zlibLimiter;
    var PerMessageDeflate2 = class {
      /**
       * Creates a PerMessageDeflate instance.
       *
       * @param {Object} [options] Configuration options
       * @param {(Boolean|Number)} [options.clientMaxWindowBits] Advertise support
       *     for, or request, a custom client window size
       * @param {Boolean} [options.clientNoContextTakeover=false] Advertise/
       *     acknowledge disabling of client context takeover
       * @param {Number} [options.concurrencyLimit=10] The number of concurrent
       *     calls to zlib
       * @param {Boolean} [options.isServer=false] Create the instance in either
       *     server or client mode
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {(Boolean|Number)} [options.serverMaxWindowBits] Request/confirm the
       *     use of a custom server window size
       * @param {Boolean} [options.serverNoContextTakeover=false] Request/accept
       *     disabling of server context takeover
       * @param {Number} [options.threshold=1024] Size (in bytes) below which
       *     messages should not be compressed if context takeover is disabled
       * @param {Object} [options.zlibDeflateOptions] Options to pass to zlib on
       *     deflate
       * @param {Object} [options.zlibInflateOptions] Options to pass to zlib on
       *     inflate
       */
      constructor(options) {
        this._options = options || {};
        this._threshold = this._options.threshold !== void 0 ? this._options.threshold : 1024;
        this._maxPayload = this._options.maxPayload | 0;
        this._isServer = !!this._options.isServer;
        this._deflate = null;
        this._inflate = null;
        this.params = null;
        if (!zlibLimiter) {
          const concurrency = this._options.concurrencyLimit !== void 0 ? this._options.concurrencyLimit : 10;
          zlibLimiter = new Limiter(concurrency);
        }
      }
      /**
       * @type {String}
       */
      static get extensionName() {
        return "permessage-deflate";
      }
      /**
       * Create an extension negotiation offer.
       *
       * @return {Object} Extension parameters
       * @public
       */
      offer() {
        const params = {};
        if (this._options.serverNoContextTakeover) {
          params.server_no_context_takeover = true;
        }
        if (this._options.clientNoContextTakeover) {
          params.client_no_context_takeover = true;
        }
        if (this._options.serverMaxWindowBits) {
          params.server_max_window_bits = this._options.serverMaxWindowBits;
        }
        if (this._options.clientMaxWindowBits) {
          params.client_max_window_bits = this._options.clientMaxWindowBits;
        } else if (this._options.clientMaxWindowBits == null) {
          params.client_max_window_bits = true;
        }
        return params;
      }
      /**
       * Accept an extension negotiation offer/response.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Object} Accepted configuration
       * @public
       */
      accept(configurations) {
        configurations = this.normalizeParams(configurations);
        this.params = this._isServer ? this.acceptAsServer(configurations) : this.acceptAsClient(configurations);
        return this.params;
      }
      /**
       * Releases all resources used by the extension.
       *
       * @public
       */
      cleanup() {
        if (this._inflate) {
          this._inflate.close();
          this._inflate = null;
        }
        if (this._deflate) {
          const callback = this._deflate[kCallback];
          this._deflate.close();
          this._deflate = null;
          if (callback) {
            callback(
              new Error(
                "The deflate stream was closed while data was being processed"
              )
            );
          }
        }
      }
      /**
       *  Accept an extension negotiation offer.
       *
       * @param {Array} offers The extension negotiation offers
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsServer(offers) {
        const opts = this._options;
        const accepted = offers.find((params) => {
          if (opts.serverNoContextTakeover === false && params.server_no_context_takeover || params.server_max_window_bits && (opts.serverMaxWindowBits === false || typeof opts.serverMaxWindowBits === "number" && opts.serverMaxWindowBits > params.server_max_window_bits) || typeof opts.clientMaxWindowBits === "number" && !params.client_max_window_bits) {
            return false;
          }
          return true;
        });
        if (!accepted) {
          throw new Error("None of the extension offers can be accepted");
        }
        if (opts.serverNoContextTakeover) {
          accepted.server_no_context_takeover = true;
        }
        if (opts.clientNoContextTakeover) {
          accepted.client_no_context_takeover = true;
        }
        if (typeof opts.serverMaxWindowBits === "number") {
          accepted.server_max_window_bits = opts.serverMaxWindowBits;
        }
        if (typeof opts.clientMaxWindowBits === "number") {
          accepted.client_max_window_bits = opts.clientMaxWindowBits;
        } else if (accepted.client_max_window_bits === true || opts.clientMaxWindowBits === false) {
          delete accepted.client_max_window_bits;
        }
        return accepted;
      }
      /**
       * Accept the extension negotiation response.
       *
       * @param {Array} response The extension negotiation response
       * @return {Object} Accepted configuration
       * @private
       */
      acceptAsClient(response) {
        const params = response[0];
        if (this._options.clientNoContextTakeover === false && params.client_no_context_takeover) {
          throw new Error('Unexpected parameter "client_no_context_takeover"');
        }
        if (!params.client_max_window_bits) {
          if (typeof this._options.clientMaxWindowBits === "number") {
            params.client_max_window_bits = this._options.clientMaxWindowBits;
          }
        } else if (this._options.clientMaxWindowBits === false || typeof this._options.clientMaxWindowBits === "number" && params.client_max_window_bits > this._options.clientMaxWindowBits) {
          throw new Error(
            'Unexpected or invalid parameter "client_max_window_bits"'
          );
        }
        return params;
      }
      /**
       * Normalize parameters.
       *
       * @param {Array} configurations The extension negotiation offers/reponse
       * @return {Array} The offers/response with normalized parameters
       * @private
       */
      normalizeParams(configurations) {
        configurations.forEach((params) => {
          Object.keys(params).forEach((key) => {
            let value = params[key];
            if (value.length > 1) {
              throw new Error(`Parameter "${key}" must have only a single value`);
            }
            value = value[0];
            if (key === "client_max_window_bits") {
              if (value !== true) {
                const num = +value;
                if (!Number.isInteger(num) || num < 8 || num > 15) {
                  throw new TypeError(
                    `Invalid value for parameter "${key}": ${value}`
                  );
                }
                value = num;
              } else if (!this._isServer) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else if (key === "server_max_window_bits") {
              const num = +value;
              if (!Number.isInteger(num) || num < 8 || num > 15) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
              value = num;
            } else if (key === "client_no_context_takeover" || key === "server_no_context_takeover") {
              if (value !== true) {
                throw new TypeError(
                  `Invalid value for parameter "${key}": ${value}`
                );
              }
            } else {
              throw new Error(`Unknown parameter "${key}"`);
            }
            params[key] = value;
          });
        });
        return configurations;
      }
      /**
       * Decompress data. Concurrency limited.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      decompress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._decompress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Compress data. Concurrency limited.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @public
       */
      compress(data, fin, callback) {
        zlibLimiter.add((done) => {
          this._compress(data, fin, (err, result) => {
            done();
            callback(err, result);
          });
        });
      }
      /**
       * Decompress data.
       *
       * @param {Buffer} data Compressed data
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _decompress(data, fin, callback) {
        const endpoint = this._isServer ? "client" : "server";
        if (!this._inflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._inflate = zlib.createInflateRaw({
            ...this._options.zlibInflateOptions,
            windowBits
          });
          this._inflate[kPerMessageDeflate] = this;
          this._inflate[kTotalLength] = 0;
          this._inflate[kBuffers] = [];
          this._inflate.on("error", inflateOnError);
          this._inflate.on("data", inflateOnData);
        }
        this._inflate[kCallback] = callback;
        this._inflate.write(data);
        if (fin)
          this._inflate.write(TRAILER);
        this._inflate.flush(() => {
          const err = this._inflate[kError];
          if (err) {
            this._inflate.close();
            this._inflate = null;
            callback(err);
            return;
          }
          const data2 = bufferUtil.concat(
            this._inflate[kBuffers],
            this._inflate[kTotalLength]
          );
          if (this._inflate._readableState.endEmitted) {
            this._inflate.close();
            this._inflate = null;
          } else {
            this._inflate[kTotalLength] = 0;
            this._inflate[kBuffers] = [];
            if (fin && this.params[`${endpoint}_no_context_takeover`]) {
              this._inflate.reset();
            }
          }
          callback(null, data2);
        });
      }
      /**
       * Compress data.
       *
       * @param {(Buffer|String)} data Data to compress
       * @param {Boolean} fin Specifies whether or not this is the last fragment
       * @param {Function} callback Callback
       * @private
       */
      _compress(data, fin, callback) {
        const endpoint = this._isServer ? "server" : "client";
        if (!this._deflate) {
          const key = `${endpoint}_max_window_bits`;
          const windowBits = typeof this.params[key] !== "number" ? zlib.Z_DEFAULT_WINDOWBITS : this.params[key];
          this._deflate = zlib.createDeflateRaw({
            ...this._options.zlibDeflateOptions,
            windowBits
          });
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          this._deflate.on("data", deflateOnData);
        }
        this._deflate[kCallback] = callback;
        this._deflate.write(data);
        this._deflate.flush(zlib.Z_SYNC_FLUSH, () => {
          if (!this._deflate) {
            return;
          }
          let data2 = bufferUtil.concat(
            this._deflate[kBuffers],
            this._deflate[kTotalLength]
          );
          if (fin) {
            data2 = new FastBuffer(data2.buffer, data2.byteOffset, data2.length - 4);
          }
          this._deflate[kCallback] = null;
          this._deflate[kTotalLength] = 0;
          this._deflate[kBuffers] = [];
          if (fin && this.params[`${endpoint}_no_context_takeover`]) {
            this._deflate.reset();
          }
          callback(null, data2);
        });
      }
    };
    module2.exports = PerMessageDeflate2;
    function deflateOnData(chunk) {
      this[kBuffers].push(chunk);
      this[kTotalLength] += chunk.length;
    }
    function inflateOnData(chunk) {
      this[kTotalLength] += chunk.length;
      if (this[kPerMessageDeflate]._maxPayload < 1 || this[kTotalLength] <= this[kPerMessageDeflate]._maxPayload) {
        this[kBuffers].push(chunk);
        return;
      }
      this[kError] = new RangeError("Max payload size exceeded");
      this[kError].code = "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH";
      this[kError][kStatusCode] = 1009;
      this.removeListener("data", inflateOnData);
      this.reset();
    }
    function inflateOnError(err) {
      this[kPerMessageDeflate]._inflate = null;
      if (this[kError]) {
        this[kCallback](this[kError]);
        return;
      }
      err[kStatusCode] = 1007;
      this[kCallback](err);
    }
  }
});

// node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/validation.js
var require_validation = __commonJS({
  "node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/validation.js"(exports2, module2) {
    "use strict";
    var { isUtf8 } = require("buffer");
    var { hasBlob } = require_constants();
    var tokenChars = [
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 0 - 15
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      // 16 - 31
      0,
      1,
      0,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      0,
      // 32 - 47
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      // 48 - 63
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 64 - 79
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      0,
      0,
      1,
      1,
      // 80 - 95
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      // 96 - 111
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0,
      1,
      0,
      1,
      0
      // 112 - 127
    ];
    function isValidStatusCode(code) {
      return code >= 1e3 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006 || code >= 3e3 && code <= 4999;
    }
    function _isValidUTF8(buf) {
      const len = buf.length;
      let i = 0;
      while (i < len) {
        if ((buf[i] & 128) === 0) {
          i++;
        } else if ((buf[i] & 224) === 192) {
          if (i + 1 === len || (buf[i + 1] & 192) !== 128 || (buf[i] & 254) === 192) {
            return false;
          }
          i += 2;
        } else if ((buf[i] & 240) === 224) {
          if (i + 2 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || buf[i] === 224 && (buf[i + 1] & 224) === 128 || // Overlong
          buf[i] === 237 && (buf[i + 1] & 224) === 160) {
            return false;
          }
          i += 3;
        } else if ((buf[i] & 248) === 240) {
          if (i + 3 >= len || (buf[i + 1] & 192) !== 128 || (buf[i + 2] & 192) !== 128 || (buf[i + 3] & 192) !== 128 || buf[i] === 240 && (buf[i + 1] & 240) === 128 || // Overlong
          buf[i] === 244 && buf[i + 1] > 143 || buf[i] > 244) {
            return false;
          }
          i += 4;
        } else {
          return false;
        }
      }
      return true;
    }
    function isBlob(value) {
      return hasBlob && typeof value === "object" && typeof value.arrayBuffer === "function" && typeof value.type === "string" && typeof value.stream === "function" && (value[Symbol.toStringTag] === "Blob" || value[Symbol.toStringTag] === "File");
    }
    module2.exports = {
      isBlob,
      isValidStatusCode,
      isValidUTF8: _isValidUTF8,
      tokenChars
    };
    if (isUtf8) {
      module2.exports.isValidUTF8 = function(buf) {
        return buf.length < 24 ? _isValidUTF8(buf) : isUtf8(buf);
      };
    } else if (!process.env.WS_NO_UTF_8_VALIDATE) {
      try {
        const isValidUTF8 = require("utf-8-validate");
        module2.exports.isValidUTF8 = function(buf) {
          return buf.length < 32 ? _isValidUTF8(buf) : isValidUTF8(buf);
        };
      } catch (e) {
      }
    }
  }
});

// node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/receiver.js
var require_receiver = __commonJS({
  "node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/receiver.js"(exports2, module2) {
    "use strict";
    var { Writable } = require("stream");
    var PerMessageDeflate2 = require_permessage_deflate();
    var {
      BINARY_TYPES,
      EMPTY_BUFFER,
      kStatusCode,
      kWebSocket
    } = require_constants();
    var { concat, toArrayBuffer, unmask } = require_buffer_util();
    var { isValidStatusCode, isValidUTF8 } = require_validation();
    var FastBuffer = Buffer[Symbol.species];
    var GET_INFO = 0;
    var GET_PAYLOAD_LENGTH_16 = 1;
    var GET_PAYLOAD_LENGTH_64 = 2;
    var GET_MASK = 3;
    var GET_DATA = 4;
    var INFLATING = 5;
    var DEFER_EVENT = 6;
    var Receiver2 = class extends Writable {
      /**
       * Creates a Receiver instance.
       *
       * @param {Object} [options] Options object
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {String} [options.binaryType=nodebuffer] The type for binary data
       * @param {Object} [options.extensions] An object containing the negotiated
       *     extensions
       * @param {Boolean} [options.isServer=false] Specifies whether to operate in
       *     client or server mode
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message length
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       */
      constructor(options = {}) {
        super();
        this._allowSynchronousEvents = options.allowSynchronousEvents !== void 0 ? options.allowSynchronousEvents : true;
        this._binaryType = options.binaryType || BINARY_TYPES[0];
        this._extensions = options.extensions || {};
        this._isServer = !!options.isServer;
        this._maxBufferedChunks = options.maxBufferedChunks | 0;
        this._maxFragments = options.maxFragments | 0;
        this._maxPayload = options.maxPayload | 0;
        this._skipUTF8Validation = !!options.skipUTF8Validation;
        this[kWebSocket] = void 0;
        this._bufferedBytes = 0;
        this._buffers = [];
        this._compressed = false;
        this._payloadLength = 0;
        this._mask = void 0;
        this._fragmented = 0;
        this._masked = false;
        this._fin = false;
        this._opcode = 0;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._numFragments = 0;
        this._fragments = [];
        this._errored = false;
        this._loop = false;
        this._state = GET_INFO;
      }
      /**
       * Implements `Writable.prototype._write()`.
       *
       * @param {Buffer} chunk The chunk of data to write
       * @param {String} encoding The character encoding of `chunk`
       * @param {Function} cb Callback
       * @private
       */
      _write(chunk, encoding, cb) {
        if (this._opcode === 8 && this._state == GET_INFO)
          return cb();
        if (this._maxBufferedChunks > 0 && this._buffers.length >= this._maxBufferedChunks) {
          cb(
            this.createError(
              RangeError,
              "Too many buffered chunks",
              false,
              1008,
              "WS_ERR_TOO_MANY_BUFFERED_PARTS"
            )
          );
          return;
        }
        this._bufferedBytes += chunk.length;
        this._buffers.push(chunk);
        this.startLoop(cb);
      }
      /**
       * Consumes `n` bytes from the buffered data.
       *
       * @param {Number} n The number of bytes to consume
       * @return {Buffer} The consumed bytes
       * @private
       */
      consume(n) {
        this._bufferedBytes -= n;
        if (n === this._buffers[0].length)
          return this._buffers.shift();
        if (n < this._buffers[0].length) {
          const buf = this._buffers[0];
          this._buffers[0] = new FastBuffer(
            buf.buffer,
            buf.byteOffset + n,
            buf.length - n
          );
          return new FastBuffer(buf.buffer, buf.byteOffset, n);
        }
        const dst = Buffer.allocUnsafe(n);
        do {
          const buf = this._buffers[0];
          const offset = dst.length - n;
          if (n >= buf.length) {
            dst.set(this._buffers.shift(), offset);
          } else {
            dst.set(new Uint8Array(buf.buffer, buf.byteOffset, n), offset);
            this._buffers[0] = new FastBuffer(
              buf.buffer,
              buf.byteOffset + n,
              buf.length - n
            );
          }
          n -= buf.length;
        } while (n > 0);
        return dst;
      }
      /**
       * Starts the parsing loop.
       *
       * @param {Function} cb Callback
       * @private
       */
      startLoop(cb) {
        this._loop = true;
        do {
          switch (this._state) {
            case GET_INFO:
              this.getInfo(cb);
              break;
            case GET_PAYLOAD_LENGTH_16:
              this.getPayloadLength16(cb);
              break;
            case GET_PAYLOAD_LENGTH_64:
              this.getPayloadLength64(cb);
              break;
            case GET_MASK:
              this.getMask();
              break;
            case GET_DATA:
              this.getData(cb);
              break;
            case INFLATING:
            case DEFER_EVENT:
              this._loop = false;
              return;
          }
        } while (this._loop);
        if (!this._errored)
          cb();
      }
      /**
       * Reads the first two bytes of a frame.
       *
       * @param {Function} cb Callback
       * @private
       */
      getInfo(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        const buf = this.consume(2);
        if ((buf[0] & 48) !== 0) {
          const error = this.createError(
            RangeError,
            "RSV2 and RSV3 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_2_3"
          );
          cb(error);
          return;
        }
        const compressed = (buf[0] & 64) === 64;
        if (compressed && !this._extensions[PerMessageDeflate2.extensionName]) {
          const error = this.createError(
            RangeError,
            "RSV1 must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_RSV_1"
          );
          cb(error);
          return;
        }
        this._fin = (buf[0] & 128) === 128;
        this._opcode = buf[0] & 15;
        this._payloadLength = buf[1] & 127;
        if (this._opcode === 0) {
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (!this._fragmented) {
            const error = this.createError(
              RangeError,
              "invalid opcode 0",
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._opcode = this._fragmented;
        } else if (this._opcode === 1 || this._opcode === 2) {
          if (this._fragmented) {
            const error = this.createError(
              RangeError,
              `invalid opcode ${this._opcode}`,
              true,
              1002,
              "WS_ERR_INVALID_OPCODE"
            );
            cb(error);
            return;
          }
          this._compressed = compressed;
        } else if (this._opcode > 7 && this._opcode < 11) {
          if (!this._fin) {
            const error = this.createError(
              RangeError,
              "FIN must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_FIN"
            );
            cb(error);
            return;
          }
          if (compressed) {
            const error = this.createError(
              RangeError,
              "RSV1 must be clear",
              true,
              1002,
              "WS_ERR_UNEXPECTED_RSV_1"
            );
            cb(error);
            return;
          }
          if (this._payloadLength > 125 || this._opcode === 8 && this._payloadLength === 1) {
            const error = this.createError(
              RangeError,
              `invalid payload length ${this._payloadLength}`,
              true,
              1002,
              "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"
            );
            cb(error);
            return;
          }
        } else {
          const error = this.createError(
            RangeError,
            `invalid opcode ${this._opcode}`,
            true,
            1002,
            "WS_ERR_INVALID_OPCODE"
          );
          cb(error);
          return;
        }
        if (!this._fin && !this._fragmented)
          this._fragmented = this._opcode;
        this._masked = (buf[1] & 128) === 128;
        if (this._isServer) {
          if (!this._masked) {
            const error = this.createError(
              RangeError,
              "MASK must be set",
              true,
              1002,
              "WS_ERR_EXPECTED_MASK"
            );
            cb(error);
            return;
          }
        } else if (this._masked) {
          const error = this.createError(
            RangeError,
            "MASK must be clear",
            true,
            1002,
            "WS_ERR_UNEXPECTED_MASK"
          );
          cb(error);
          return;
        }
        if (this._payloadLength === 126)
          this._state = GET_PAYLOAD_LENGTH_16;
        else if (this._payloadLength === 127)
          this._state = GET_PAYLOAD_LENGTH_64;
        else
          this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+16).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength16(cb) {
        if (this._bufferedBytes < 2) {
          this._loop = false;
          return;
        }
        this._payloadLength = this.consume(2).readUInt16BE(0);
        this.haveLength(cb);
      }
      /**
       * Gets extended payload length (7+64).
       *
       * @param {Function} cb Callback
       * @private
       */
      getPayloadLength64(cb) {
        if (this._bufferedBytes < 8) {
          this._loop = false;
          return;
        }
        const buf = this.consume(8);
        const num = buf.readUInt32BE(0);
        if (num > Math.pow(2, 53 - 32) - 1) {
          const error = this.createError(
            RangeError,
            "Unsupported WebSocket frame: payload length > 2^53 - 1",
            false,
            1009,
            "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"
          );
          cb(error);
          return;
        }
        this._payloadLength = num * Math.pow(2, 32) + buf.readUInt32BE(4);
        this.haveLength(cb);
      }
      /**
       * Payload length has been read.
       *
       * @param {Function} cb Callback
       * @private
       */
      haveLength(cb) {
        if (this._payloadLength && this._opcode < 8) {
          this._totalPayloadLength += this._payloadLength;
          if (this._totalPayloadLength > this._maxPayload && this._maxPayload > 0) {
            const error = this.createError(
              RangeError,
              "Max payload size exceeded",
              false,
              1009,
              "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
            );
            cb(error);
            return;
          }
        }
        if (this._masked)
          this._state = GET_MASK;
        else
          this._state = GET_DATA;
      }
      /**
       * Reads mask bytes.
       *
       * @private
       */
      getMask() {
        if (this._bufferedBytes < 4) {
          this._loop = false;
          return;
        }
        this._mask = this.consume(4);
        this._state = GET_DATA;
      }
      /**
       * Reads data bytes.
       *
       * @param {Function} cb Callback
       * @private
       */
      getData(cb) {
        let data = EMPTY_BUFFER;
        if (this._payloadLength) {
          if (this._bufferedBytes < this._payloadLength) {
            this._loop = false;
            return;
          }
          data = this.consume(this._payloadLength);
          if (this._masked && (this._mask[0] | this._mask[1] | this._mask[2] | this._mask[3]) !== 0) {
            unmask(data, this._mask);
          }
        }
        if (this._opcode > 7) {
          this.controlMessage(data, cb);
          return;
        }
        if (this._maxFragments > 0 && ++this._numFragments > this._maxFragments) {
          const error = this.createError(
            RangeError,
            "Too many message fragments",
            false,
            1008,
            "WS_ERR_TOO_MANY_BUFFERED_PARTS"
          );
          cb(error);
          return;
        }
        if (this._compressed) {
          this._state = INFLATING;
          this.decompress(data, cb);
          return;
        }
        if (data.length) {
          this._messageLength = this._totalPayloadLength;
          this._fragments.push(data);
        }
        this.dataMessage(cb);
      }
      /**
       * Decompresses data.
       *
       * @param {Buffer} data Compressed data
       * @param {Function} cb Callback
       * @private
       */
      decompress(data, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        perMessageDeflate.decompress(data, this._fin, (err, buf) => {
          if (err)
            return cb(err);
          if (buf.length) {
            this._messageLength += buf.length;
            if (this._messageLength > this._maxPayload && this._maxPayload > 0) {
              const error = this.createError(
                RangeError,
                "Max payload size exceeded",
                false,
                1009,
                "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"
              );
              cb(error);
              return;
            }
            this._fragments.push(buf);
          }
          this.dataMessage(cb);
          if (this._state === GET_INFO)
            this.startLoop(cb);
        });
      }
      /**
       * Handles a data message.
       *
       * @param {Function} cb Callback
       * @private
       */
      dataMessage(cb) {
        if (!this._fin) {
          this._state = GET_INFO;
          return;
        }
        const messageLength = this._messageLength;
        const fragments = this._fragments;
        this._totalPayloadLength = 0;
        this._messageLength = 0;
        this._fragmented = 0;
        this._numFragments = 0;
        this._fragments = [];
        if (this._opcode === 2) {
          let data;
          if (this._binaryType === "nodebuffer") {
            data = concat(fragments, messageLength);
          } else if (this._binaryType === "arraybuffer") {
            data = toArrayBuffer(concat(fragments, messageLength));
          } else if (this._binaryType === "blob") {
            data = new Blob(fragments);
          } else {
            data = fragments;
          }
          if (this._allowSynchronousEvents) {
            this.emit("message", data, true);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", data, true);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        } else {
          const buf = concat(fragments, messageLength);
          if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
            const error = this.createError(
              Error,
              "invalid UTF-8 sequence",
              true,
              1007,
              "WS_ERR_INVALID_UTF8"
            );
            cb(error);
            return;
          }
          if (this._state === INFLATING || this._allowSynchronousEvents) {
            this.emit("message", buf, false);
            this._state = GET_INFO;
          } else {
            this._state = DEFER_EVENT;
            setImmediate(() => {
              this.emit("message", buf, false);
              this._state = GET_INFO;
              this.startLoop(cb);
            });
          }
        }
      }
      /**
       * Handles a control message.
       *
       * @param {Buffer} data Data to handle
       * @return {(Error|RangeError|undefined)} A possible error
       * @private
       */
      controlMessage(data, cb) {
        if (this._opcode === 8) {
          if (data.length === 0) {
            this._loop = false;
            this.emit("conclude", 1005, EMPTY_BUFFER);
            this.end();
          } else {
            const code = data.readUInt16BE(0);
            if (!isValidStatusCode(code)) {
              const error = this.createError(
                RangeError,
                `invalid status code ${code}`,
                true,
                1002,
                "WS_ERR_INVALID_CLOSE_CODE"
              );
              cb(error);
              return;
            }
            const buf = new FastBuffer(
              data.buffer,
              data.byteOffset + 2,
              data.length - 2
            );
            if (!this._skipUTF8Validation && !isValidUTF8(buf)) {
              const error = this.createError(
                Error,
                "invalid UTF-8 sequence",
                true,
                1007,
                "WS_ERR_INVALID_UTF8"
              );
              cb(error);
              return;
            }
            this._loop = false;
            this.emit("conclude", code, buf);
            this.end();
          }
          this._state = GET_INFO;
          return;
        }
        if (this._allowSynchronousEvents) {
          this.emit(this._opcode === 9 ? "ping" : "pong", data);
          this._state = GET_INFO;
        } else {
          this._state = DEFER_EVENT;
          setImmediate(() => {
            this.emit(this._opcode === 9 ? "ping" : "pong", data);
            this._state = GET_INFO;
            this.startLoop(cb);
          });
        }
      }
      /**
       * Builds an error object.
       *
       * @param {function(new:Error|RangeError)} ErrorCtor The error constructor
       * @param {String} message The error message
       * @param {Boolean} prefix Specifies whether or not to add a default prefix to
       *     `message`
       * @param {Number} statusCode The status code
       * @param {String} errorCode The exposed error code
       * @return {(Error|RangeError)} The error
       * @private
       */
      createError(ErrorCtor, message, prefix, statusCode, errorCode) {
        this._loop = false;
        this._errored = true;
        const err = new ErrorCtor(
          prefix ? `Invalid WebSocket frame: ${message}` : message
        );
        Error.captureStackTrace(err, this.createError);
        err.code = errorCode;
        err[kStatusCode] = statusCode;
        return err;
      }
    };
    module2.exports = Receiver2;
  }
});

// node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/sender.js
var require_sender = __commonJS({
  "node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/sender.js"(exports2, module2) {
    "use strict";
    var { Duplex } = require("stream");
    var { randomFillSync } = require("crypto");
    var {
      types: { isUint8Array }
    } = require("util");
    var PerMessageDeflate2 = require_permessage_deflate();
    var { EMPTY_BUFFER, kWebSocket, NOOP } = require_constants();
    var { isBlob, isValidStatusCode } = require_validation();
    var { mask: applyMask, toBuffer } = require_buffer_util();
    var kByteLength = Symbol("kByteLength");
    var maskBuffer = Buffer.alloc(4);
    var RANDOM_POOL_SIZE = 8 * 1024;
    var randomPool;
    var randomPoolPointer = RANDOM_POOL_SIZE;
    var DEFAULT = 0;
    var DEFLATING = 1;
    var GET_BLOB_DATA = 2;
    var Sender2 = class _Sender {
      /**
       * Creates a Sender instance.
       *
       * @param {Duplex} socket The connection socket
       * @param {Object} [extensions] An object containing the negotiated extensions
       * @param {Function} [generateMask] The function used to generate the masking
       *     key
       */
      constructor(socket, extensions, generateMask) {
        this._extensions = extensions || {};
        if (generateMask) {
          this._generateMask = generateMask;
          this._maskBuffer = Buffer.alloc(4);
        }
        this._socket = socket;
        this._firstFragment = true;
        this._compress = false;
        this._bufferedBytes = 0;
        this._queue = [];
        this._state = DEFAULT;
        this.onerror = NOOP;
        this[kWebSocket] = void 0;
      }
      /**
       * Frames a piece of data according to the HyBi WebSocket protocol.
       *
       * @param {(Buffer|String)} data The data to frame
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @return {(Buffer|String)[]} The framed data
       * @public
       */
      static frame(data, options) {
        let mask;
        let merge = false;
        let offset = 2;
        let skipMasking = false;
        if (options.mask) {
          mask = options.maskBuffer || maskBuffer;
          if (options.generateMask) {
            options.generateMask(mask);
          } else {
            if (randomPoolPointer === RANDOM_POOL_SIZE) {
              if (randomPool === void 0) {
                randomPool = Buffer.alloc(RANDOM_POOL_SIZE);
              }
              randomFillSync(randomPool, 0, RANDOM_POOL_SIZE);
              randomPoolPointer = 0;
            }
            mask[0] = randomPool[randomPoolPointer++];
            mask[1] = randomPool[randomPoolPointer++];
            mask[2] = randomPool[randomPoolPointer++];
            mask[3] = randomPool[randomPoolPointer++];
          }
          skipMasking = (mask[0] | mask[1] | mask[2] | mask[3]) === 0;
          offset = 6;
        }
        let dataLength;
        if (typeof data === "string") {
          if ((!options.mask || skipMasking) && options[kByteLength] !== void 0) {
            dataLength = options[kByteLength];
          } else {
            data = Buffer.from(data);
            dataLength = data.length;
          }
        } else {
          dataLength = data.length;
          merge = options.mask && options.readOnly && !skipMasking;
        }
        let payloadLength = dataLength;
        if (dataLength >= 65536) {
          offset += 8;
          payloadLength = 127;
        } else if (dataLength > 125) {
          offset += 2;
          payloadLength = 126;
        }
        const target = Buffer.allocUnsafe(merge ? dataLength + offset : offset);
        target[0] = options.fin ? options.opcode | 128 : options.opcode;
        if (options.rsv1)
          target[0] |= 64;
        target[1] = payloadLength;
        if (payloadLength === 126) {
          target.writeUInt16BE(dataLength, 2);
        } else if (payloadLength === 127) {
          target[2] = target[3] = 0;
          target.writeUIntBE(dataLength, 4, 6);
        }
        if (!options.mask)
          return [target, data];
        target[1] |= 128;
        target[offset - 4] = mask[0];
        target[offset - 3] = mask[1];
        target[offset - 2] = mask[2];
        target[offset - 1] = mask[3];
        if (skipMasking)
          return [target, data];
        if (merge) {
          applyMask(data, mask, target, offset, dataLength);
          return [target];
        }
        applyMask(data, mask, data, 0, dataLength);
        return [target, data];
      }
      /**
       * Sends a close message to the other peer.
       *
       * @param {Number} [code] The status code component of the body
       * @param {(String|Buffer)} [data] The message component of the body
       * @param {Boolean} [mask=false] Specifies whether or not to mask the message
       * @param {Function} [cb] Callback
       * @public
       */
      close(code, data, mask, cb) {
        let buf;
        if (code === void 0) {
          buf = EMPTY_BUFFER;
        } else if (typeof code !== "number" || !isValidStatusCode(code)) {
          throw new TypeError("First argument must be a valid error code number");
        } else if (data === void 0 || !data.length) {
          buf = Buffer.allocUnsafe(2);
          buf.writeUInt16BE(code, 0);
        } else {
          const length = Buffer.byteLength(data);
          if (length > 123) {
            throw new RangeError("The message must not be greater than 123 bytes");
          }
          buf = Buffer.allocUnsafe(2 + length);
          buf.writeUInt16BE(code, 0);
          if (typeof data === "string") {
            buf.write(data, 2);
          } else if (isUint8Array(data)) {
            buf.set(data, 2);
          } else {
            throw new TypeError("Second argument must be a string or a Uint8Array");
          }
        }
        const options = {
          [kByteLength]: buf.length,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 8,
          readOnly: false,
          rsv1: false
        };
        if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, buf, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(buf, options), cb);
        }
      }
      /**
       * Sends a ping message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      ping(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 9,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a pong message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Boolean} [mask=false] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback
       * @public
       */
      pong(data, mask, cb) {
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (byteLength > 125) {
          throw new RangeError("The data size must not be greater than 125 bytes");
        }
        const options = {
          [kByteLength]: byteLength,
          fin: true,
          generateMask: this._generateMask,
          mask,
          maskBuffer: this._maskBuffer,
          opcode: 10,
          readOnly,
          rsv1: false
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, false, options, cb]);
          } else {
            this.getBlobData(data, false, options, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, false, options, cb]);
        } else {
          this.sendFrame(_Sender.frame(data, options), cb);
        }
      }
      /**
       * Sends a data message to the other peer.
       *
       * @param {*} data The message to send
       * @param {Object} options Options object
       * @param {Boolean} [options.binary=false] Specifies whether `data` is binary
       *     or text
       * @param {Boolean} [options.compress=false] Specifies whether or not to
       *     compress `data`
       * @param {Boolean} [options.fin=false] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Function} [cb] Callback
       * @public
       */
      send(data, options, cb) {
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        let opcode = options.binary ? 2 : 1;
        let rsv1 = options.compress;
        let byteLength;
        let readOnly;
        if (typeof data === "string") {
          byteLength = Buffer.byteLength(data);
          readOnly = false;
        } else if (isBlob(data)) {
          byteLength = data.size;
          readOnly = false;
        } else {
          data = toBuffer(data);
          byteLength = data.length;
          readOnly = toBuffer.readOnly;
        }
        if (this._firstFragment) {
          this._firstFragment = false;
          if (rsv1 && perMessageDeflate && perMessageDeflate.params[perMessageDeflate._isServer ? "server_no_context_takeover" : "client_no_context_takeover"]) {
            rsv1 = byteLength >= perMessageDeflate._threshold;
          }
          this._compress = rsv1;
        } else {
          rsv1 = false;
          opcode = 0;
        }
        if (options.fin)
          this._firstFragment = true;
        const opts = {
          [kByteLength]: byteLength,
          fin: options.fin,
          generateMask: this._generateMask,
          mask: options.mask,
          maskBuffer: this._maskBuffer,
          opcode,
          readOnly,
          rsv1
        };
        if (isBlob(data)) {
          if (this._state !== DEFAULT) {
            this.enqueue([this.getBlobData, data, this._compress, opts, cb]);
          } else {
            this.getBlobData(data, this._compress, opts, cb);
          }
        } else if (this._state !== DEFAULT) {
          this.enqueue([this.dispatch, data, this._compress, opts, cb]);
        } else {
          this.dispatch(data, this._compress, opts, cb);
        }
      }
      /**
       * Gets the contents of a blob as binary data.
       *
       * @param {Blob} blob The blob
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     the data
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      getBlobData(blob, compress, options, cb) {
        this._bufferedBytes += options[kByteLength];
        this._state = GET_BLOB_DATA;
        blob.arrayBuffer().then((arrayBuffer) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while the blob was being read"
            );
            process.nextTick(callCallbacks, this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          const data = toBuffer(arrayBuffer);
          if (!compress) {
            this._state = DEFAULT;
            this.sendFrame(_Sender.frame(data, options), cb);
            this.dequeue();
          } else {
            this.dispatch(data, compress, options, cb);
          }
        }).catch((err) => {
          process.nextTick(onError, this, err, cb);
        });
      }
      /**
       * Dispatches a message.
       *
       * @param {(Buffer|String)} data The message to send
       * @param {Boolean} [compress=false] Specifies whether or not to compress
       *     `data`
       * @param {Object} options Options object
       * @param {Boolean} [options.fin=false] Specifies whether or not to set the
       *     FIN bit
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Boolean} [options.mask=false] Specifies whether or not to mask
       *     `data`
       * @param {Buffer} [options.maskBuffer] The buffer used to store the masking
       *     key
       * @param {Number} options.opcode The opcode
       * @param {Boolean} [options.readOnly=false] Specifies whether `data` can be
       *     modified
       * @param {Boolean} [options.rsv1=false] Specifies whether or not to set the
       *     RSV1 bit
       * @param {Function} [cb] Callback
       * @private
       */
      dispatch(data, compress, options, cb) {
        if (!compress) {
          this.sendFrame(_Sender.frame(data, options), cb);
          return;
        }
        const perMessageDeflate = this._extensions[PerMessageDeflate2.extensionName];
        this._bufferedBytes += options[kByteLength];
        this._state = DEFLATING;
        perMessageDeflate.compress(data, options.fin, (_, buf) => {
          if (this._socket.destroyed) {
            const err = new Error(
              "The socket was closed while data was being compressed"
            );
            callCallbacks(this, err, cb);
            return;
          }
          this._bufferedBytes -= options[kByteLength];
          this._state = DEFAULT;
          options.readOnly = false;
          this.sendFrame(_Sender.frame(buf, options), cb);
          this.dequeue();
        });
      }
      /**
       * Executes queued send operations.
       *
       * @private
       */
      dequeue() {
        while (this._state === DEFAULT && this._queue.length) {
          const params = this._queue.shift();
          this._bufferedBytes -= params[3][kByteLength];
          Reflect.apply(params[0], this, params.slice(1));
        }
      }
      /**
       * Enqueues a send operation.
       *
       * @param {Array} params Send operation parameters.
       * @private
       */
      enqueue(params) {
        this._bufferedBytes += params[3][kByteLength];
        this._queue.push(params);
      }
      /**
       * Sends a frame.
       *
       * @param {(Buffer | String)[]} list The frame to send
       * @param {Function} [cb] Callback
       * @private
       */
      sendFrame(list, cb) {
        if (list.length === 2) {
          this._socket.cork();
          this._socket.write(list[0]);
          this._socket.write(list[1], cb);
          this._socket.uncork();
        } else {
          this._socket.write(list[0], cb);
        }
      }
    };
    module2.exports = Sender2;
    function callCallbacks(sender, err, cb) {
      if (typeof cb === "function")
        cb(err);
      for (let i = 0; i < sender._queue.length; i++) {
        const params = sender._queue[i];
        const callback = params[params.length - 1];
        if (typeof callback === "function")
          callback(err);
      }
    }
    function onError(sender, err, cb) {
      callCallbacks(sender, err, cb);
      sender.onerror(err);
    }
  }
});

// node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/event-target.js
var require_event_target = __commonJS({
  "node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/event-target.js"(exports2, module2) {
    "use strict";
    var { kForOnEventAttribute, kListener } = require_constants();
    var kCode = Symbol("kCode");
    var kData = Symbol("kData");
    var kError = Symbol("kError");
    var kMessage = Symbol("kMessage");
    var kReason = Symbol("kReason");
    var kTarget = Symbol("kTarget");
    var kType = Symbol("kType");
    var kWasClean = Symbol("kWasClean");
    var Event = class {
      /**
       * Create a new `Event`.
       *
       * @param {String} type The name of the event
       * @throws {TypeError} If the `type` argument is not specified
       */
      constructor(type) {
        this[kTarget] = null;
        this[kType] = type;
      }
      /**
       * @type {*}
       */
      get target() {
        return this[kTarget];
      }
      /**
       * @type {String}
       */
      get type() {
        return this[kType];
      }
    };
    Object.defineProperty(Event.prototype, "target", { enumerable: true });
    Object.defineProperty(Event.prototype, "type", { enumerable: true });
    var CloseEvent = class extends Event {
      /**
       * Create a new `CloseEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {Number} [options.code=0] The status code explaining why the
       *     connection was closed
       * @param {String} [options.reason=''] A human-readable string explaining why
       *     the connection was closed
       * @param {Boolean} [options.wasClean=false] Indicates whether or not the
       *     connection was cleanly closed
       */
      constructor(type, options = {}) {
        super(type);
        this[kCode] = options.code === void 0 ? 0 : options.code;
        this[kReason] = options.reason === void 0 ? "" : options.reason;
        this[kWasClean] = options.wasClean === void 0 ? false : options.wasClean;
      }
      /**
       * @type {Number}
       */
      get code() {
        return this[kCode];
      }
      /**
       * @type {String}
       */
      get reason() {
        return this[kReason];
      }
      /**
       * @type {Boolean}
       */
      get wasClean() {
        return this[kWasClean];
      }
    };
    Object.defineProperty(CloseEvent.prototype, "code", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "reason", { enumerable: true });
    Object.defineProperty(CloseEvent.prototype, "wasClean", { enumerable: true });
    var ErrorEvent = class extends Event {
      /**
       * Create a new `ErrorEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.error=null] The error that generated this event
       * @param {String} [options.message=''] The error message
       */
      constructor(type, options = {}) {
        super(type);
        this[kError] = options.error === void 0 ? null : options.error;
        this[kMessage] = options.message === void 0 ? "" : options.message;
      }
      /**
       * @type {*}
       */
      get error() {
        return this[kError];
      }
      /**
       * @type {String}
       */
      get message() {
        return this[kMessage];
      }
    };
    Object.defineProperty(ErrorEvent.prototype, "error", { enumerable: true });
    Object.defineProperty(ErrorEvent.prototype, "message", { enumerable: true });
    var MessageEvent = class extends Event {
      /**
       * Create a new `MessageEvent`.
       *
       * @param {String} type The name of the event
       * @param {Object} [options] A dictionary object that allows for setting
       *     attributes via object members of the same name
       * @param {*} [options.data=null] The message content
       */
      constructor(type, options = {}) {
        super(type);
        this[kData] = options.data === void 0 ? null : options.data;
      }
      /**
       * @type {*}
       */
      get data() {
        return this[kData];
      }
    };
    Object.defineProperty(MessageEvent.prototype, "data", { enumerable: true });
    var EventTarget = {
      /**
       * Register an event listener.
       *
       * @param {String} type A string representing the event type to listen for
       * @param {(Function|Object)} handler The listener to add
       * @param {Object} [options] An options object specifies characteristics about
       *     the event listener
       * @param {Boolean} [options.once=false] A `Boolean` indicating that the
       *     listener should be invoked at most once after being added. If `true`,
       *     the listener would be automatically removed when invoked.
       * @public
       */
      addEventListener(type, handler, options = {}) {
        for (const listener of this.listeners(type)) {
          if (!options[kForOnEventAttribute] && listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            return;
          }
        }
        let wrapper;
        if (type === "message") {
          wrapper = function onMessage(data, isBinary) {
            const event = new MessageEvent("message", {
              data: isBinary ? data : data.toString()
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "close") {
          wrapper = function onClose(code, message) {
            const event = new CloseEvent("close", {
              code,
              reason: message.toString(),
              wasClean: this._closeFrameReceived && this._closeFrameSent
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "error") {
          wrapper = function onError(error) {
            const event = new ErrorEvent("error", {
              error,
              message: error.message
            });
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else if (type === "open") {
          wrapper = function onOpen() {
            const event = new Event("open");
            event[kTarget] = this;
            callListener(handler, this, event);
          };
        } else {
          return;
        }
        wrapper[kForOnEventAttribute] = !!options[kForOnEventAttribute];
        wrapper[kListener] = handler;
        if (options.once) {
          this.once(type, wrapper);
        } else {
          this.on(type, wrapper);
        }
      },
      /**
       * Remove an event listener.
       *
       * @param {String} type A string representing the event type to remove
       * @param {(Function|Object)} handler The listener to remove
       * @public
       */
      removeEventListener(type, handler) {
        for (const listener of this.listeners(type)) {
          if (listener[kListener] === handler && !listener[kForOnEventAttribute]) {
            this.removeListener(type, listener);
            break;
          }
        }
      }
    };
    module2.exports = {
      CloseEvent,
      ErrorEvent,
      Event,
      EventTarget,
      MessageEvent
    };
    function callListener(listener, thisArg, event) {
      if (typeof listener === "object" && listener.handleEvent) {
        listener.handleEvent.call(listener, event);
      } else {
        listener.call(thisArg, event);
      }
    }
  }
});

// node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/extension.js
var require_extension = __commonJS({
  "node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/extension.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function push(dest, name, elem) {
      if (dest[name] === void 0)
        dest[name] = [elem];
      else
        dest[name].push(elem);
    }
    function parse(header) {
      const offers = /* @__PURE__ */ Object.create(null);
      let params = /* @__PURE__ */ Object.create(null);
      let mustUnescape = false;
      let isEscaping = false;
      let inQuotes = false;
      let extensionName;
      let paramName;
      let start = -1;
      let code = -1;
      let end = -1;
      let i = 0;
      for (; i < header.length; i++) {
        code = header.charCodeAt(i);
        if (extensionName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1)
              start = i;
          } else if (i !== 0 && (code === 32 || code === 9)) {
            if (end === -1 && start !== -1)
              end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1)
              end = i;
            const name = header.slice(start, end);
            if (code === 44) {
              push(offers, name, params);
              params = /* @__PURE__ */ Object.create(null);
            } else {
              extensionName = name;
            }
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else if (paramName === void 0) {
          if (end === -1 && tokenChars[code] === 1) {
            if (start === -1)
              start = i;
          } else if (code === 32 || code === 9) {
            if (end === -1 && start !== -1)
              end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1)
              end = i;
            push(params, header.slice(start, end), true);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            start = end = -1;
          } else if (code === 61 && start !== -1 && end === -1) {
            paramName = header.slice(start, i);
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        } else {
          if (isEscaping) {
            if (tokenChars[code] !== 1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (start === -1)
              start = i;
            else if (!mustUnescape)
              mustUnescape = true;
            isEscaping = false;
          } else if (inQuotes) {
            if (tokenChars[code] === 1) {
              if (start === -1)
                start = i;
            } else if (code === 34 && start !== -1) {
              inQuotes = false;
              end = i;
            } else if (code === 92) {
              isEscaping = true;
            } else {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
          } else if (code === 34 && header.charCodeAt(i - 1) === 61) {
            inQuotes = true;
          } else if (end === -1 && tokenChars[code] === 1) {
            if (start === -1)
              start = i;
          } else if (start !== -1 && (code === 32 || code === 9)) {
            if (end === -1)
              end = i;
          } else if (code === 59 || code === 44) {
            if (start === -1) {
              throw new SyntaxError(`Unexpected character at index ${i}`);
            }
            if (end === -1)
              end = i;
            let value = header.slice(start, end);
            if (mustUnescape) {
              value = value.replace(/\\/g, "");
              mustUnescape = false;
            }
            push(params, paramName, value);
            if (code === 44) {
              push(offers, extensionName, params);
              params = /* @__PURE__ */ Object.create(null);
              extensionName = void 0;
            }
            paramName = void 0;
            start = end = -1;
          } else {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
        }
      }
      if (start === -1 || inQuotes || code === 32 || code === 9) {
        throw new SyntaxError("Unexpected end of input");
      }
      if (end === -1)
        end = i;
      const token = header.slice(start, end);
      if (extensionName === void 0) {
        push(offers, token, params);
      } else {
        if (paramName === void 0) {
          push(params, token, true);
        } else if (mustUnescape) {
          push(params, paramName, token.replace(/\\/g, ""));
        } else {
          push(params, paramName, token);
        }
        push(offers, extensionName, params);
      }
      return offers;
    }
    function format(extensions) {
      return Object.keys(extensions).map((extension2) => {
        let configurations = extensions[extension2];
        if (!Array.isArray(configurations))
          configurations = [configurations];
        return configurations.map((params) => {
          return [extension2].concat(
            Object.keys(params).map((k) => {
              let values = params[k];
              if (!Array.isArray(values))
                values = [values];
              return values.map((v) => v === true ? k : `${k}=${v}`).join("; ");
            })
          ).join("; ");
        }).join(", ");
      }).join(", ");
    }
    module2.exports = { format, parse };
  }
});

// node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/websocket.js
var require_websocket = __commonJS({
  "node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/websocket.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var https3 = require("https");
    var http4 = require("http");
    var net = require("net");
    var tls = require("tls");
    var { randomBytes, createHash } = require("crypto");
    var { Duplex, Readable } = require("stream");
    var { URL: URL2 } = require("url");
    var PerMessageDeflate2 = require_permessage_deflate();
    var Receiver2 = require_receiver();
    var Sender2 = require_sender();
    var { isBlob } = require_validation();
    var {
      BINARY_TYPES,
      CLOSE_TIMEOUT,
      EMPTY_BUFFER,
      GUID,
      kForOnEventAttribute,
      kListener,
      kStatusCode,
      kWebSocket,
      NOOP
    } = require_constants();
    var {
      EventTarget: { addEventListener, removeEventListener }
    } = require_event_target();
    var { format, parse } = require_extension();
    var { toBuffer } = require_buffer_util();
    var kAborted = Symbol("kAborted");
    var protocolVersions = [8, 13];
    var readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
    var subprotocolRegex = /^[!#$%&'*+\-.0-9A-Z^_`|a-z~]+$/;
    var WebSocket2 = class _WebSocket extends EventEmitter {
      /**
       * Create a new `WebSocket`.
       *
       * @param {(String|URL)} address The URL to which to connect
       * @param {(String|String[])} [protocols] The subprotocols
       * @param {Object} [options] Connection options
       */
      constructor(address, protocols, options) {
        super();
        this._binaryType = BINARY_TYPES[0];
        this._closeCode = 1006;
        this._closeFrameReceived = false;
        this._closeFrameSent = false;
        this._closeMessage = EMPTY_BUFFER;
        this._closeTimer = null;
        this._errorEmitted = false;
        this._extensions = {};
        this._paused = false;
        this._protocol = "";
        this._readyState = _WebSocket.CONNECTING;
        this._receiver = null;
        this._sender = null;
        this._socket = null;
        if (address !== null) {
          this._bufferedAmount = 0;
          this._isServer = false;
          this._redirects = 0;
          if (protocols === void 0) {
            protocols = [];
          } else if (!Array.isArray(protocols)) {
            if (typeof protocols === "object" && protocols !== null) {
              options = protocols;
              protocols = [];
            } else {
              protocols = [protocols];
            }
          }
          initAsClient(this, address, protocols, options);
        } else {
          this._autoPong = options.autoPong;
          this._closeTimeout = options.closeTimeout;
          this._isServer = true;
        }
      }
      /**
       * For historical reasons, the custom "nodebuffer" type is used by the default
       * instead of "blob".
       *
       * @type {String}
       */
      get binaryType() {
        return this._binaryType;
      }
      set binaryType(type) {
        if (!BINARY_TYPES.includes(type))
          return;
        this._binaryType = type;
        if (this._receiver)
          this._receiver._binaryType = type;
      }
      /**
       * @type {Number}
       */
      get bufferedAmount() {
        if (!this._socket)
          return this._bufferedAmount;
        return this._socket._writableState.length + this._sender._bufferedBytes;
      }
      /**
       * @type {String}
       */
      get extensions() {
        return Object.keys(this._extensions).join();
      }
      /**
       * @type {Boolean}
       */
      get isPaused() {
        return this._paused;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onclose() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onerror() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onopen() {
        return null;
      }
      /**
       * @type {Function}
       */
      /* istanbul ignore next */
      get onmessage() {
        return null;
      }
      /**
       * @type {String}
       */
      get protocol() {
        return this._protocol;
      }
      /**
       * @type {Number}
       */
      get readyState() {
        return this._readyState;
      }
      /**
       * @type {String}
       */
      get url() {
        return this._url;
      }
      /**
       * Set up the socket and the internal resources.
       *
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Object} options Options object
       * @param {Boolean} [options.allowSynchronousEvents=false] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Function} [options.generateMask] The function used to generate the
       *     masking key
       * @param {Number} [options.maxBufferedChunks=0] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=0] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=0] The maximum allowed message size
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @private
       */
      setSocket(socket, head, options) {
        const receiver = new Receiver2({
          allowSynchronousEvents: options.allowSynchronousEvents,
          binaryType: this.binaryType,
          extensions: this._extensions,
          isServer: this._isServer,
          maxBufferedChunks: options.maxBufferedChunks,
          maxFragments: options.maxFragments,
          maxPayload: options.maxPayload,
          skipUTF8Validation: options.skipUTF8Validation
        });
        const sender = new Sender2(socket, this._extensions, options.generateMask);
        this._receiver = receiver;
        this._sender = sender;
        this._socket = socket;
        receiver[kWebSocket] = this;
        sender[kWebSocket] = this;
        socket[kWebSocket] = this;
        receiver.on("conclude", receiverOnConclude);
        receiver.on("drain", receiverOnDrain);
        receiver.on("error", receiverOnError);
        receiver.on("message", receiverOnMessage);
        receiver.on("ping", receiverOnPing);
        receiver.on("pong", receiverOnPong);
        sender.onerror = senderOnError;
        if (socket.setTimeout)
          socket.setTimeout(0);
        if (socket.setNoDelay)
          socket.setNoDelay();
        if (head.length > 0)
          socket.unshift(head);
        socket.on("close", socketOnClose);
        socket.on("data", socketOnData);
        socket.on("end", socketOnEnd);
        socket.on("error", socketOnError);
        this._readyState = _WebSocket.OPEN;
        this.emit("open");
      }
      /**
       * Emit the `'close'` event.
       *
       * @private
       */
      emitClose() {
        if (!this._socket) {
          this._readyState = _WebSocket.CLOSED;
          this.emit("close", this._closeCode, this._closeMessage);
          return;
        }
        if (this._extensions[PerMessageDeflate2.extensionName]) {
          this._extensions[PerMessageDeflate2.extensionName].cleanup();
        }
        this._receiver.removeAllListeners();
        this._readyState = _WebSocket.CLOSED;
        this.emit("close", this._closeCode, this._closeMessage);
      }
      /**
       * Start a closing handshake.
       *
       *          +----------+   +-----------+   +----------+
       *     - - -|ws.close()|-->|close frame|-->|ws.close()|- - -
       *    |     +----------+   +-----------+   +----------+     |
       *          +----------+   +-----------+         |
       * CLOSING  |ws.close()|<--|close frame|<--+-----+       CLOSING
       *          +----------+   +-----------+   |
       *    |           |                        |   +---+        |
       *                +------------------------+-->|fin| - - - -
       *    |         +---+                      |   +---+
       *     - - - - -|fin|<---------------------+
       *              +---+
       *
       * @param {Number} [code] Status code explaining why the connection is closing
       * @param {(String|Buffer)} [data] The reason why the connection is
       *     closing
       * @public
       */
      close(code, data) {
        if (this.readyState === _WebSocket.CLOSED)
          return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this.readyState === _WebSocket.CLOSING) {
          if (this._closeFrameSent && (this._closeFrameReceived || this._receiver._writableState.errorEmitted)) {
            this._socket.end();
          }
          return;
        }
        this._readyState = _WebSocket.CLOSING;
        this._sender.close(code, data, !this._isServer, (err) => {
          if (err)
            return;
          this._closeFrameSent = true;
          if (this._closeFrameReceived || this._receiver._writableState.errorEmitted) {
            this._socket.end();
          }
        });
        setCloseTimer(this);
      }
      /**
       * Pause the socket.
       *
       * @public
       */
      pause() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = true;
        this._socket.pause();
      }
      /**
       * Send a ping.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the ping is sent
       * @public
       */
      ping(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number")
          data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0)
          mask = !this._isServer;
        this._sender.ping(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Send a pong.
       *
       * @param {*} [data] The data to send
       * @param {Boolean} [mask] Indicates whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when the pong is sent
       * @public
       */
      pong(data, mask, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof data === "function") {
          cb = data;
          data = mask = void 0;
        } else if (typeof mask === "function") {
          cb = mask;
          mask = void 0;
        }
        if (typeof data === "number")
          data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        if (mask === void 0)
          mask = !this._isServer;
        this._sender.pong(data || EMPTY_BUFFER, mask, cb);
      }
      /**
       * Resume the socket.
       *
       * @public
       */
      resume() {
        if (this.readyState === _WebSocket.CONNECTING || this.readyState === _WebSocket.CLOSED) {
          return;
        }
        this._paused = false;
        if (!this._receiver._writableState.needDrain)
          this._socket.resume();
      }
      /**
       * Send a data message.
       *
       * @param {*} data The message to send
       * @param {Object} [options] Options object
       * @param {Boolean} [options.binary] Specifies whether `data` is binary or
       *     text
       * @param {Boolean} [options.compress] Specifies whether or not to compress
       *     `data`
       * @param {Boolean} [options.fin=true] Specifies whether the fragment is the
       *     last one
       * @param {Boolean} [options.mask] Specifies whether or not to mask `data`
       * @param {Function} [cb] Callback which is executed when data is written out
       * @public
       */
      send(data, options, cb) {
        if (this.readyState === _WebSocket.CONNECTING) {
          throw new Error("WebSocket is not open: readyState 0 (CONNECTING)");
        }
        if (typeof options === "function") {
          cb = options;
          options = {};
        }
        if (typeof data === "number")
          data = data.toString();
        if (this.readyState !== _WebSocket.OPEN) {
          sendAfterClose(this, data, cb);
          return;
        }
        const opts = {
          binary: typeof data !== "string",
          mask: !this._isServer,
          compress: true,
          fin: true,
          ...options
        };
        if (!this._extensions[PerMessageDeflate2.extensionName]) {
          opts.compress = false;
        }
        this._sender.send(data || EMPTY_BUFFER, opts, cb);
      }
      /**
       * Forcibly close the connection.
       *
       * @public
       */
      terminate() {
        if (this.readyState === _WebSocket.CLOSED)
          return;
        if (this.readyState === _WebSocket.CONNECTING) {
          const msg = "WebSocket was closed before the connection was established";
          abortHandshake(this, this._req, msg);
          return;
        }
        if (this._socket) {
          this._readyState = _WebSocket.CLOSING;
          this._socket.destroy();
        }
      }
    };
    Object.defineProperty(WebSocket2, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2.prototype, "CONNECTING", {
      enumerable: true,
      value: readyStates.indexOf("CONNECTING")
    });
    Object.defineProperty(WebSocket2, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2.prototype, "OPEN", {
      enumerable: true,
      value: readyStates.indexOf("OPEN")
    });
    Object.defineProperty(WebSocket2, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSING", {
      enumerable: true,
      value: readyStates.indexOf("CLOSING")
    });
    Object.defineProperty(WebSocket2, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    Object.defineProperty(WebSocket2.prototype, "CLOSED", {
      enumerable: true,
      value: readyStates.indexOf("CLOSED")
    });
    [
      "binaryType",
      "bufferedAmount",
      "extensions",
      "isPaused",
      "protocol",
      "readyState",
      "url"
    ].forEach((property) => {
      Object.defineProperty(WebSocket2.prototype, property, { enumerable: true });
    });
    ["open", "error", "close", "message"].forEach((method) => {
      Object.defineProperty(WebSocket2.prototype, `on${method}`, {
        enumerable: true,
        get() {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute])
              return listener[kListener];
          }
          return null;
        },
        set(handler) {
          for (const listener of this.listeners(method)) {
            if (listener[kForOnEventAttribute]) {
              this.removeListener(method, listener);
              break;
            }
          }
          if (typeof handler !== "function")
            return;
          this.addEventListener(method, handler, {
            [kForOnEventAttribute]: true
          });
        }
      });
    });
    WebSocket2.prototype.addEventListener = addEventListener;
    WebSocket2.prototype.removeEventListener = removeEventListener;
    module2.exports = WebSocket2;
    function initAsClient(websocket, address, protocols, options) {
      const opts = {
        allowSynchronousEvents: true,
        autoPong: true,
        closeTimeout: CLOSE_TIMEOUT,
        protocolVersion: protocolVersions[1],
        maxBufferedChunks: 256 * 1024,
        maxFragments: 16 * 1024,
        maxPayload: 100 * 1024 * 1024,
        skipUTF8Validation: false,
        perMessageDeflate: true,
        followRedirects: false,
        maxRedirects: 10,
        ...options,
        socketPath: void 0,
        hostname: void 0,
        protocol: void 0,
        timeout: void 0,
        method: "GET",
        host: void 0,
        path: void 0,
        port: void 0
      };
      websocket._autoPong = opts.autoPong;
      websocket._closeTimeout = opts.closeTimeout;
      if (!protocolVersions.includes(opts.protocolVersion)) {
        throw new RangeError(
          `Unsupported protocol version: ${opts.protocolVersion} (supported versions: ${protocolVersions.join(", ")})`
        );
      }
      let parsedUrl;
      if (address instanceof URL2) {
        parsedUrl = address;
      } else {
        try {
          parsedUrl = new URL2(address);
        } catch {
          throw new SyntaxError(`Invalid URL: ${address}`);
        }
      }
      if (parsedUrl.protocol === "http:") {
        parsedUrl.protocol = "ws:";
      } else if (parsedUrl.protocol === "https:") {
        parsedUrl.protocol = "wss:";
      }
      websocket._url = parsedUrl.href;
      const isSecure = parsedUrl.protocol === "wss:";
      const isIpcUrl = parsedUrl.protocol === "ws+unix:";
      let invalidUrlMessage;
      if (parsedUrl.protocol !== "ws:" && !isSecure && !isIpcUrl) {
        invalidUrlMessage = `The URL's protocol must be one of "ws:", "wss:", "http:", "https:", or "ws+unix:"`;
      } else if (isIpcUrl && !parsedUrl.pathname) {
        invalidUrlMessage = "The URL's pathname is empty";
      } else if (parsedUrl.hash) {
        invalidUrlMessage = "The URL contains a fragment identifier";
      }
      if (invalidUrlMessage) {
        const err = new SyntaxError(invalidUrlMessage);
        if (websocket._redirects === 0) {
          throw err;
        } else {
          emitErrorAndClose(websocket, err);
          return;
        }
      }
      const defaultPort = isSecure ? 443 : 80;
      const key = randomBytes(16).toString("base64");
      const request2 = isSecure ? https3.request : http4.request;
      const protocolSet = /* @__PURE__ */ new Set();
      let perMessageDeflate;
      opts.createConnection = opts.createConnection || (isSecure ? tlsConnect : netConnect);
      opts.defaultPort = opts.defaultPort || defaultPort;
      opts.port = parsedUrl.port || defaultPort;
      opts.host = parsedUrl.hostname.startsWith("[") ? parsedUrl.hostname.slice(1, -1) : parsedUrl.hostname;
      opts.headers = {
        ...opts.headers,
        "Sec-WebSocket-Version": opts.protocolVersion,
        "Sec-WebSocket-Key": key,
        Connection: "Upgrade",
        Upgrade: "websocket"
      };
      opts.path = parsedUrl.pathname + parsedUrl.search;
      opts.timeout = opts.handshakeTimeout;
      if (opts.perMessageDeflate) {
        perMessageDeflate = new PerMessageDeflate2({
          ...opts.perMessageDeflate,
          isServer: false,
          maxPayload: opts.maxPayload
        });
        opts.headers["Sec-WebSocket-Extensions"] = format({
          [PerMessageDeflate2.extensionName]: perMessageDeflate.offer()
        });
      }
      if (protocols.length) {
        for (const protocol of protocols) {
          if (typeof protocol !== "string" || !subprotocolRegex.test(protocol) || protocolSet.has(protocol)) {
            throw new SyntaxError(
              "An invalid or duplicated subprotocol was specified"
            );
          }
          protocolSet.add(protocol);
        }
        opts.headers["Sec-WebSocket-Protocol"] = protocols.join(",");
      }
      if (opts.origin) {
        if (opts.protocolVersion < 13) {
          opts.headers["Sec-WebSocket-Origin"] = opts.origin;
        } else {
          opts.headers.Origin = opts.origin;
        }
      }
      if (parsedUrl.username || parsedUrl.password) {
        opts.auth = `${parsedUrl.username}:${parsedUrl.password}`;
      }
      if (isIpcUrl) {
        const parts = opts.path.split(":");
        opts.socketPath = parts[0];
        opts.path = parts[1];
      }
      let req;
      if (opts.followRedirects) {
        if (websocket._redirects === 0) {
          websocket._originalIpc = isIpcUrl;
          websocket._originalSecure = isSecure;
          websocket._originalHostOrSocketPath = isIpcUrl ? opts.socketPath : parsedUrl.host;
          const headers = options && options.headers;
          options = { ...options, headers: {} };
          if (headers) {
            for (const [key2, value] of Object.entries(headers)) {
              options.headers[key2.toLowerCase()] = value;
            }
          }
        } else if (websocket.listenerCount("redirect") === 0) {
          const isSameHost = isIpcUrl ? websocket._originalIpc ? opts.socketPath === websocket._originalHostOrSocketPath : false : websocket._originalIpc ? false : parsedUrl.host === websocket._originalHostOrSocketPath;
          if (!isSameHost || websocket._originalSecure && !isSecure) {
            delete opts.headers.authorization;
            delete opts.headers.cookie;
            if (!isSameHost)
              delete opts.headers.host;
            opts.auth = void 0;
          }
        }
        if (opts.auth && !options.headers.authorization) {
          options.headers.authorization = "Basic " + Buffer.from(opts.auth).toString("base64");
        }
        req = websocket._req = request2(opts);
        if (websocket._redirects) {
          websocket.emit("redirect", websocket.url, req);
        }
      } else {
        req = websocket._req = request2(opts);
      }
      if (opts.timeout) {
        req.on("timeout", () => {
          abortHandshake(websocket, req, "Opening handshake has timed out");
        });
      }
      req.on("error", (err) => {
        if (req === null || req[kAborted])
          return;
        req = websocket._req = null;
        emitErrorAndClose(websocket, err);
      });
      req.on("response", (res) => {
        const location = res.headers.location;
        const statusCode = res.statusCode;
        if (location && opts.followRedirects && statusCode >= 300 && statusCode < 400) {
          if (++websocket._redirects > opts.maxRedirects) {
            abortHandshake(websocket, req, "Maximum redirects exceeded");
            return;
          }
          req.abort();
          let addr;
          try {
            addr = new URL2(location, address);
          } catch (e) {
            const err = new SyntaxError(`Invalid URL: ${location}`);
            emitErrorAndClose(websocket, err);
            return;
          }
          initAsClient(websocket, addr, protocols, options);
        } else if (!websocket.emit("unexpected-response", req, res)) {
          abortHandshake(
            websocket,
            req,
            `Unexpected server response: ${res.statusCode}`
          );
        }
      });
      req.on("upgrade", (res, socket, head) => {
        websocket.emit("upgrade", res);
        if (websocket.readyState !== WebSocket2.CONNECTING)
          return;
        req = websocket._req = null;
        const upgrade = res.headers.upgrade;
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          abortHandshake(websocket, socket, "Invalid Upgrade header");
          return;
        }
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        if (res.headers["sec-websocket-accept"] !== digest) {
          abortHandshake(websocket, socket, "Invalid Sec-WebSocket-Accept header");
          return;
        }
        const serverProt = res.headers["sec-websocket-protocol"];
        let protError;
        if (serverProt !== void 0) {
          if (!protocolSet.size) {
            protError = "Server sent a subprotocol but none was requested";
          } else if (!protocolSet.has(serverProt)) {
            protError = "Server sent an invalid subprotocol";
          }
        } else if (protocolSet.size) {
          protError = "Server sent no subprotocol";
        }
        if (protError) {
          abortHandshake(websocket, socket, protError);
          return;
        }
        if (serverProt)
          websocket._protocol = serverProt;
        const secWebSocketExtensions = res.headers["sec-websocket-extensions"];
        if (secWebSocketExtensions !== void 0) {
          if (!perMessageDeflate) {
            const message = "Server sent a Sec-WebSocket-Extensions header but no extension was requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          let extensions;
          try {
            extensions = parse(secWebSocketExtensions);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          const extensionNames = Object.keys(extensions);
          if (extensionNames.length !== 1 || extensionNames[0] !== PerMessageDeflate2.extensionName) {
            const message = "Server indicated an extension that was not requested";
            abortHandshake(websocket, socket, message);
            return;
          }
          try {
            perMessageDeflate.accept(extensions[PerMessageDeflate2.extensionName]);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Extensions header";
            abortHandshake(websocket, socket, message);
            return;
          }
          websocket._extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
        }
        websocket.setSocket(socket, head, {
          allowSynchronousEvents: opts.allowSynchronousEvents,
          generateMask: opts.generateMask,
          maxBufferedChunks: opts.maxBufferedChunks,
          maxFragments: opts.maxFragments,
          maxPayload: opts.maxPayload,
          skipUTF8Validation: opts.skipUTF8Validation
        });
      });
      if (opts.finishRequest) {
        opts.finishRequest(req, websocket);
      } else {
        req.end();
      }
    }
    function emitErrorAndClose(websocket, err) {
      websocket._readyState = WebSocket2.CLOSING;
      websocket._errorEmitted = true;
      websocket.emit("error", err);
      websocket.emitClose();
    }
    function netConnect(options) {
      options.path = options.socketPath;
      return net.connect(options);
    }
    function tlsConnect(options) {
      options.path = void 0;
      if (!options.servername && options.servername !== "") {
        options.servername = net.isIP(options.host) ? "" : options.host;
      }
      return tls.connect(options);
    }
    function abortHandshake(websocket, stream, message) {
      websocket._readyState = WebSocket2.CLOSING;
      const err = new Error(message);
      Error.captureStackTrace(err, abortHandshake);
      if (stream.setHeader) {
        stream[kAborted] = true;
        stream.abort();
        if (stream.socket && !stream.socket.destroyed) {
          stream.socket.destroy();
        }
        process.nextTick(emitErrorAndClose, websocket, err);
      } else {
        stream.destroy(err);
        stream.once("error", websocket.emit.bind(websocket, "error"));
        stream.once("close", websocket.emitClose.bind(websocket));
      }
    }
    function sendAfterClose(websocket, data, cb) {
      if (data) {
        const length = isBlob(data) ? data.size : toBuffer(data).length;
        if (websocket._socket)
          websocket._sender._bufferedBytes += length;
        else
          websocket._bufferedAmount += length;
      }
      if (cb) {
        const err = new Error(
          `WebSocket is not open: readyState ${websocket.readyState} (${readyStates[websocket.readyState]})`
        );
        process.nextTick(cb, err);
      }
    }
    function receiverOnConclude(code, reason) {
      const websocket = this[kWebSocket];
      websocket._closeFrameReceived = true;
      websocket._closeMessage = reason;
      websocket._closeCode = code;
      if (websocket._socket[kWebSocket] === void 0)
        return;
      websocket._socket.removeListener("data", socketOnData);
      process.nextTick(resume, websocket._socket);
      if (code === 1005)
        websocket.close();
      else
        websocket.close(code, reason);
    }
    function receiverOnDrain() {
      const websocket = this[kWebSocket];
      if (!websocket.isPaused)
        websocket._socket.resume();
    }
    function receiverOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket._socket[kWebSocket] !== void 0) {
        websocket._socket.removeListener("data", socketOnData);
        process.nextTick(resume, websocket._socket);
        websocket.close(err[kStatusCode]);
      }
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function receiverOnFinish() {
      this[kWebSocket].emitClose();
    }
    function receiverOnMessage(data, isBinary) {
      this[kWebSocket].emit("message", data, isBinary);
    }
    function receiverOnPing(data) {
      const websocket = this[kWebSocket];
      if (websocket._autoPong)
        websocket.pong(data, !this._isServer, NOOP);
      websocket.emit("ping", data);
    }
    function receiverOnPong(data) {
      this[kWebSocket].emit("pong", data);
    }
    function resume(stream) {
      stream.resume();
    }
    function senderOnError(err) {
      const websocket = this[kWebSocket];
      if (websocket.readyState === WebSocket2.CLOSED)
        return;
      if (websocket.readyState === WebSocket2.OPEN) {
        websocket._readyState = WebSocket2.CLOSING;
        setCloseTimer(websocket);
      }
      this._socket.end();
      if (!websocket._errorEmitted) {
        websocket._errorEmitted = true;
        websocket.emit("error", err);
      }
    }
    function setCloseTimer(websocket) {
      websocket._closeTimer = setTimeout(
        websocket._socket.destroy.bind(websocket._socket),
        websocket._closeTimeout
      );
    }
    function socketOnClose() {
      const websocket = this[kWebSocket];
      this.removeListener("close", socketOnClose);
      this.removeListener("data", socketOnData);
      this.removeListener("end", socketOnEnd);
      websocket._readyState = WebSocket2.CLOSING;
      if (!this._readableState.endEmitted && !websocket._closeFrameReceived && !websocket._receiver._writableState.errorEmitted && this._readableState.length !== 0) {
        const chunk = this.read(this._readableState.length);
        websocket._receiver.write(chunk);
      }
      websocket._receiver.end();
      this[kWebSocket] = void 0;
      clearTimeout(websocket._closeTimer);
      if (websocket._receiver._writableState.finished || websocket._receiver._writableState.errorEmitted) {
        websocket.emitClose();
      } else {
        websocket._receiver.on("error", receiverOnFinish);
        websocket._receiver.on("finish", receiverOnFinish);
      }
    }
    function socketOnData(chunk) {
      if (!this[kWebSocket]._receiver.write(chunk)) {
        this.pause();
      }
    }
    function socketOnEnd() {
      const websocket = this[kWebSocket];
      websocket._readyState = WebSocket2.CLOSING;
      websocket._receiver.end();
      this.end();
    }
    function socketOnError() {
      const websocket = this[kWebSocket];
      this.removeListener("error", socketOnError);
      this.on("error", NOOP);
      if (websocket) {
        websocket._readyState = WebSocket2.CLOSING;
        this.destroy();
      }
    }
  }
});

// node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/stream.js
var require_stream = __commonJS({
  "node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/stream.js"(exports2, module2) {
    "use strict";
    var WebSocket2 = require_websocket();
    var { Duplex } = require("stream");
    function emitClose(stream) {
      stream.emit("close");
    }
    function duplexOnEnd() {
      if (!this.destroyed && this._writableState.finished) {
        this.destroy();
      }
    }
    function duplexOnError(err) {
      this.removeListener("error", duplexOnError);
      this.destroy();
      if (this.listenerCount("error") === 0) {
        this.emit("error", err);
      }
    }
    function createWebSocketStream2(ws, options) {
      let terminateOnDestroy = true;
      const duplex = new Duplex({
        ...options,
        autoDestroy: false,
        emitClose: false,
        objectMode: false,
        writableObjectMode: false
      });
      ws.on("message", function message(msg, isBinary) {
        const data = !isBinary && duplex._readableState.objectMode ? msg.toString() : msg;
        if (!duplex.push(data))
          ws.pause();
      });
      ws.once("error", function error(err) {
        if (duplex.destroyed)
          return;
        terminateOnDestroy = false;
        duplex.destroy(err);
      });
      ws.once("close", function close() {
        if (duplex.destroyed)
          return;
        duplex.push(null);
      });
      duplex._destroy = function(err, callback) {
        if (ws.readyState === ws.CLOSED) {
          callback(err);
          process.nextTick(emitClose, duplex);
          return;
        }
        let called = false;
        ws.once("error", function error(err2) {
          called = true;
          callback(err2);
        });
        ws.once("close", function close() {
          if (!called)
            callback(err);
          process.nextTick(emitClose, duplex);
        });
        if (terminateOnDestroy)
          ws.terminate();
      };
      duplex._final = function(callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._final(callback);
          });
          return;
        }
        if (ws._socket === null)
          return;
        if (ws._socket._writableState.finished) {
          callback();
          if (duplex._readableState.endEmitted)
            duplex.destroy();
        } else {
          ws._socket.once("finish", function finish() {
            callback();
          });
          ws.close();
        }
      };
      duplex._read = function() {
        if (ws.isPaused)
          ws.resume();
      };
      duplex._write = function(chunk, encoding, callback) {
        if (ws.readyState === ws.CONNECTING) {
          ws.once("open", function open() {
            duplex._write(chunk, encoding, callback);
          });
          return;
        }
        ws.send(chunk, callback);
      };
      duplex.on("end", duplexOnEnd);
      duplex.on("error", duplexOnError);
      return duplex;
    }
    module2.exports = createWebSocketStream2;
  }
});

// node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/subprotocol.js
var require_subprotocol = __commonJS({
  "node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/subprotocol.js"(exports2, module2) {
    "use strict";
    var { tokenChars } = require_validation();
    function parse(header) {
      const protocols = /* @__PURE__ */ new Set();
      let start = -1;
      let end = -1;
      let i = 0;
      for (i; i < header.length; i++) {
        const code = header.charCodeAt(i);
        if (end === -1 && tokenChars[code] === 1) {
          if (start === -1)
            start = i;
        } else if (i !== 0 && (code === 32 || code === 9)) {
          if (end === -1 && start !== -1)
            end = i;
        } else if (code === 44) {
          if (start === -1) {
            throw new SyntaxError(`Unexpected character at index ${i}`);
          }
          if (end === -1)
            end = i;
          const protocol2 = header.slice(start, end);
          if (protocols.has(protocol2)) {
            throw new SyntaxError(`The "${protocol2}" subprotocol is duplicated`);
          }
          protocols.add(protocol2);
          start = end = -1;
        } else {
          throw new SyntaxError(`Unexpected character at index ${i}`);
        }
      }
      if (start === -1 || end !== -1) {
        throw new SyntaxError("Unexpected end of input");
      }
      const protocol = header.slice(start, i);
      if (protocols.has(protocol)) {
        throw new SyntaxError(`The "${protocol}" subprotocol is duplicated`);
      }
      protocols.add(protocol);
      return protocols;
    }
    module2.exports = { parse };
  }
});

// node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/websocket-server.js
var require_websocket_server = __commonJS({
  "node_modules/.pnpm/ws@8.21.1/node_modules/ws/lib/websocket-server.js"(exports2, module2) {
    "use strict";
    var EventEmitter = require("events");
    var http4 = require("http");
    var { Duplex } = require("stream");
    var { createHash } = require("crypto");
    var extension2 = require_extension();
    var PerMessageDeflate2 = require_permessage_deflate();
    var subprotocol2 = require_subprotocol();
    var WebSocket2 = require_websocket();
    var { CLOSE_TIMEOUT, GUID, kWebSocket } = require_constants();
    var keyRegex = /^[+/0-9A-Za-z]{22}==$/;
    var RUNNING = 0;
    var CLOSING = 1;
    var CLOSED = 2;
    var WebSocketServer2 = class extends EventEmitter {
      /**
       * Create a `WebSocketServer` instance.
       *
       * @param {Object} options Configuration options
       * @param {Boolean} [options.allowSynchronousEvents=true] Specifies whether
       *     any of the `'message'`, `'ping'`, and `'pong'` events can be emitted
       *     multiple times in the same tick
       * @param {Boolean} [options.autoPong=true] Specifies whether or not to
       *     automatically send a pong in response to a ping
       * @param {Number} [options.backlog=511] The maximum length of the queue of
       *     pending connections
       * @param {Boolean} [options.clientTracking=true] Specifies whether or not to
       *     track clients
       * @param {Number} [options.closeTimeout=30000] Duration in milliseconds to
       *     wait for the closing handshake to finish after `websocket.close()` is
       *     called
       * @param {Function} [options.handleProtocols] A hook to handle protocols
       * @param {String} [options.host] The hostname where to bind the server
       * @param {Number} [options.maxBufferedChunks=262144] The maximum number of
       *     buffered data chunks
       * @param {Number} [options.maxFragments=16384] The maximum number of message
       *     fragments
       * @param {Number} [options.maxPayload=104857600] The maximum allowed message
       *     size
       * @param {Boolean} [options.noServer=false] Enable no server mode
       * @param {String} [options.path] Accept only connections matching this path
       * @param {(Boolean|Object)} [options.perMessageDeflate=false] Enable/disable
       *     permessage-deflate
       * @param {Number} [options.port] The port where to bind the server
       * @param {(http.Server|https.Server)} [options.server] A pre-created HTTP/S
       *     server to use
       * @param {Boolean} [options.skipUTF8Validation=false] Specifies whether or
       *     not to skip UTF-8 validation for text and close messages
       * @param {Function} [options.verifyClient] A hook to reject connections
       * @param {Function} [options.WebSocket=WebSocket] Specifies the `WebSocket`
       *     class to use. It must be the `WebSocket` class or class that extends it
       * @param {Function} [callback] A listener for the `listening` event
       */
      constructor(options, callback) {
        super();
        options = {
          allowSynchronousEvents: true,
          autoPong: true,
          maxBufferedChunks: 256 * 1024,
          maxFragments: 16 * 1024,
          maxPayload: 100 * 1024 * 1024,
          skipUTF8Validation: false,
          perMessageDeflate: false,
          handleProtocols: null,
          clientTracking: true,
          closeTimeout: CLOSE_TIMEOUT,
          verifyClient: null,
          noServer: false,
          backlog: null,
          // use default (511 as implemented in net.js)
          server: null,
          host: null,
          path: null,
          port: null,
          WebSocket: WebSocket2,
          ...options
        };
        if (options.port == null && !options.server && !options.noServer || options.port != null && (options.server || options.noServer) || options.server && options.noServer) {
          throw new TypeError(
            'One and only one of the "port", "server", or "noServer" options must be specified'
          );
        }
        if (options.port != null) {
          this._server = http4.createServer((req, res) => {
            const body = http4.STATUS_CODES[426];
            res.writeHead(426, {
              "Content-Length": body.length,
              "Content-Type": "text/plain"
            });
            res.end(body);
          });
          this._server.listen(
            options.port,
            options.host,
            options.backlog,
            callback
          );
        } else if (options.server) {
          this._server = options.server;
        }
        if (this._server) {
          const emitConnection = this.emit.bind(this, "connection");
          this._removeListeners = addListeners(this._server, {
            listening: this.emit.bind(this, "listening"),
            error: this.emit.bind(this, "error"),
            upgrade: (req, socket, head) => {
              this.handleUpgrade(req, socket, head, emitConnection);
            }
          });
        }
        if (options.perMessageDeflate === true)
          options.perMessageDeflate = {};
        if (options.clientTracking) {
          this.clients = /* @__PURE__ */ new Set();
          this._shouldEmitClose = false;
        }
        this.options = options;
        this._state = RUNNING;
      }
      /**
       * Returns the bound address, the address family name, and port of the server
       * as reported by the operating system if listening on an IP socket.
       * If the server is listening on a pipe or UNIX domain socket, the name is
       * returned as a string.
       *
       * @return {(Object|String|null)} The address of the server
       * @public
       */
      address() {
        if (this.options.noServer) {
          throw new Error('The server is operating in "noServer" mode');
        }
        if (!this._server)
          return null;
        return this._server.address();
      }
      /**
       * Stop the server from accepting new connections and emit the `'close'` event
       * when all existing connections are closed.
       *
       * @param {Function} [cb] A one-time listener for the `'close'` event
       * @public
       */
      close(cb) {
        if (this._state === CLOSED) {
          if (cb) {
            this.once("close", () => {
              cb(new Error("The server is not running"));
            });
          }
          process.nextTick(emitClose, this);
          return;
        }
        if (cb)
          this.once("close", cb);
        if (this._state === CLOSING)
          return;
        this._state = CLOSING;
        if (this.options.noServer || this.options.server) {
          if (this._server) {
            this._removeListeners();
            this._removeListeners = this._server = null;
          }
          if (this.clients) {
            if (!this.clients.size) {
              process.nextTick(emitClose, this);
            } else {
              this._shouldEmitClose = true;
            }
          } else {
            process.nextTick(emitClose, this);
          }
        } else {
          const server2 = this._server;
          this._removeListeners();
          this._removeListeners = this._server = null;
          server2.close(() => {
            emitClose(this);
          });
        }
      }
      /**
       * See if a given request should be handled by this server instance.
       *
       * @param {http.IncomingMessage} req Request object to inspect
       * @return {Boolean} `true` if the request is valid, else `false`
       * @public
       */
      shouldHandle(req) {
        if (this.options.path) {
          const index = req.url.indexOf("?");
          const pathname = index !== -1 ? req.url.slice(0, index) : req.url;
          if (pathname !== this.options.path)
            return false;
        }
        return true;
      }
      /**
       * Handle a HTTP Upgrade request.
       *
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @public
       */
      handleUpgrade(req, socket, head, cb) {
        socket.on("error", socketOnError);
        const key = req.headers["sec-websocket-key"];
        const upgrade = req.headers.upgrade;
        const version = +req.headers["sec-websocket-version"];
        if (req.method !== "GET") {
          const message = "Invalid HTTP method";
          abortHandshakeOrEmitwsClientError(this, req, socket, 405, message);
          return;
        }
        if (upgrade === void 0 || upgrade.toLowerCase() !== "websocket") {
          const message = "Invalid Upgrade header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (key === void 0 || !keyRegex.test(key)) {
          const message = "Missing or invalid Sec-WebSocket-Key header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
          return;
        }
        if (version !== 13 && version !== 8) {
          const message = "Missing or invalid Sec-WebSocket-Version header";
          abortHandshakeOrEmitwsClientError(this, req, socket, 400, message, {
            "Sec-WebSocket-Version": "13, 8"
          });
          return;
        }
        if (!this.shouldHandle(req)) {
          abortHandshake(socket, 400);
          return;
        }
        const secWebSocketProtocol = req.headers["sec-websocket-protocol"];
        let protocols = /* @__PURE__ */ new Set();
        if (secWebSocketProtocol !== void 0) {
          try {
            protocols = subprotocol2.parse(secWebSocketProtocol);
          } catch (err) {
            const message = "Invalid Sec-WebSocket-Protocol header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        const secWebSocketExtensions = req.headers["sec-websocket-extensions"];
        const extensions = {};
        if (this.options.perMessageDeflate && secWebSocketExtensions !== void 0) {
          const perMessageDeflate = new PerMessageDeflate2({
            ...this.options.perMessageDeflate,
            isServer: true,
            maxPayload: this.options.maxPayload
          });
          try {
            const offers = extension2.parse(secWebSocketExtensions);
            if (offers[PerMessageDeflate2.extensionName]) {
              perMessageDeflate.accept(offers[PerMessageDeflate2.extensionName]);
              extensions[PerMessageDeflate2.extensionName] = perMessageDeflate;
            }
          } catch (err) {
            const message = "Invalid or unacceptable Sec-WebSocket-Extensions header";
            abortHandshakeOrEmitwsClientError(this, req, socket, 400, message);
            return;
          }
        }
        if (this.options.verifyClient) {
          const info = {
            origin: req.headers[`${version === 8 ? "sec-websocket-origin" : "origin"}`],
            secure: !!(req.socket.authorized || req.socket.encrypted),
            req
          };
          if (this.options.verifyClient.length === 2) {
            this.options.verifyClient(info, (verified, code, message, headers) => {
              if (!verified) {
                return abortHandshake(socket, code || 401, message, headers);
              }
              this.completeUpgrade(
                extensions,
                key,
                protocols,
                req,
                socket,
                head,
                cb
              );
            });
            return;
          }
          if (!this.options.verifyClient(info))
            return abortHandshake(socket, 401);
        }
        this.completeUpgrade(extensions, key, protocols, req, socket, head, cb);
      }
      /**
       * Upgrade the connection to WebSocket.
       *
       * @param {Object} extensions The accepted extensions
       * @param {String} key The value of the `Sec-WebSocket-Key` header
       * @param {Set} protocols The subprotocols
       * @param {http.IncomingMessage} req The request object
       * @param {Duplex} socket The network socket between the server and client
       * @param {Buffer} head The first packet of the upgraded stream
       * @param {Function} cb Callback
       * @throws {Error} If called more than once with the same socket
       * @private
       */
      completeUpgrade(extensions, key, protocols, req, socket, head, cb) {
        if (!socket.readable || !socket.writable)
          return socket.destroy();
        if (socket[kWebSocket]) {
          throw new Error(
            "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration"
          );
        }
        if (this._state > RUNNING)
          return abortHandshake(socket, 503);
        const digest = createHash("sha1").update(key + GUID).digest("base64");
        const headers = [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${digest}`
        ];
        const ws = new this.options.WebSocket(null, void 0, this.options);
        if (protocols.size) {
          const protocol = this.options.handleProtocols ? this.options.handleProtocols(protocols, req) : protocols.values().next().value;
          if (protocol) {
            headers.push(`Sec-WebSocket-Protocol: ${protocol}`);
            ws._protocol = protocol;
          }
        }
        if (extensions[PerMessageDeflate2.extensionName]) {
          const params = extensions[PerMessageDeflate2.extensionName].params;
          const value = extension2.format({
            [PerMessageDeflate2.extensionName]: [params]
          });
          headers.push(`Sec-WebSocket-Extensions: ${value}`);
          ws._extensions = extensions;
        }
        this.emit("headers", headers, req);
        socket.write(headers.concat("\r\n").join("\r\n"));
        socket.removeListener("error", socketOnError);
        ws.setSocket(socket, head, {
          allowSynchronousEvents: this.options.allowSynchronousEvents,
          maxBufferedChunks: this.options.maxBufferedChunks,
          maxFragments: this.options.maxFragments,
          maxPayload: this.options.maxPayload,
          skipUTF8Validation: this.options.skipUTF8Validation
        });
        if (this.clients) {
          this.clients.add(ws);
          ws.on("close", () => {
            this.clients.delete(ws);
            if (this._shouldEmitClose && !this.clients.size) {
              process.nextTick(emitClose, this);
            }
          });
        }
        cb(ws, req);
      }
    };
    module2.exports = WebSocketServer2;
    function addListeners(server2, map) {
      for (const event of Object.keys(map))
        server2.on(event, map[event]);
      return function removeListeners() {
        for (const event of Object.keys(map)) {
          server2.removeListener(event, map[event]);
        }
      };
    }
    function emitClose(server2) {
      server2._state = CLOSED;
      server2.emit("close");
    }
    function socketOnError() {
      this.destroy();
    }
    function abortHandshake(socket, code, message, headers) {
      message = message || http4.STATUS_CODES[code];
      headers = {
        Connection: "close",
        "Content-Type": "text/html",
        "Content-Length": Buffer.byteLength(message),
        ...headers
      };
      socket.once("finish", socket.destroy);
      socket.end(
        `HTTP/1.1 ${code} ${http4.STATUS_CODES[code]}\r
` + Object.keys(headers).map((h) => `${h}: ${headers[h]}`).join("\r\n") + "\r\n\r\n" + message
      );
    }
    function abortHandshakeOrEmitwsClientError(server2, req, socket, code, message, headers) {
      if (server2.listenerCount("wsClientError")) {
        const err = new Error(message);
        Error.captureStackTrace(err, abortHandshakeOrEmitwsClientError);
        server2.emit("wsClientError", err, socket, req);
      } else {
        abortHandshake(socket, code, message, headers);
      }
    }
  }
});

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode5 = __toESM(require("vscode"));
var path6 = __toESM(require("path"));
var os4 = __toESM(require("os"));
var fs7 = __toESM(require("fs"));

// src/lsClient.ts
var http = __toESM(require("http"));
var https = __toESM(require("https"));
var import_child_process = require("child_process");
var import_util = require("util");
var execAsync = (0, import_util.promisify)(import_child_process.exec);
var SERVICE = "exa.language_server_pb.LanguageServerService";
function extractArg(cmdLine, argName) {
  const eq = cmdLine.match(new RegExp(`--${argName}=([^\\s"]+)`));
  if (eq)
    return eq[1];
  const sp = cmdLine.match(new RegExp(`--${argName}\\s+([^\\s"]+)`));
  if (sp)
    return sp[1];
  return null;
}
async function findLsProcess() {
  const platform = process.platform;
  let output2 = "";
  try {
    if (platform === "win32") {
      const psScript = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'language_server' -and $_.CommandLine -match 'csrf_token' -and -not ($_.CommandLine -match 'enable_lsp') } | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }";
      const encoded = Buffer.from(psScript, "utf16le").toString("base64");
      const res = await execAsync(
        `powershell.exe -NoProfile -EncodedCommand ${encoded}`,
        { timeout: 8e3, windowsHide: true, maxBuffer: 1024 * 1024 }
      );
      output2 = String(res.stdout);
    } else {
      const res = await execAsync(`ps -axww -o pid=,command=`, {
        timeout: 8e3,
        maxBuffer: 8 * 1024 * 1024
      });
      output2 = String(res.stdout);
    }
  } catch {
    return null;
  }
  const lines = output2.split("\n");
  for (const line of lines) {
    if (!line.includes("language_server"))
      continue;
    if (!line.includes("csrf_token"))
      continue;
    if (line.includes("enable_lsp"))
      continue;
    let pid;
    let rest;
    if (platform === "win32") {
      const parts = line.split("|");
      pid = parseInt(parts[0].trim(), 10);
      rest = parts.slice(1).join("|");
    } else {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (!m)
        continue;
      pid = parseInt(m[1], 10);
      rest = m[2];
    }
    const csrfToken = extractArg(rest, "csrf_token");
    const extPortStr = extractArg(rest, "extension_server_port");
    const extPort = extPortStr ? parseInt(extPortStr, 10) : 0;
    if (!csrfToken || isNaN(pid))
      continue;
    return { pid, csrfToken, extPort };
  }
  return null;
}
async function listListeningPorts(pid) {
  const ports = [];
  let output2 = "";
  try {
    if (process.platform === "win32") {
      const res = await execAsync(
        `netstat -aon | findstr "LISTENING" | findstr "${pid}"`,
        { timeout: 6e3, windowsHide: true, maxBuffer: 1024 * 1024 }
      );
      output2 = String(res.stdout);
      for (const line of output2.split("\n")) {
        const m = line.match(/:(\d+)\s+.*LISTENING\s+(\d+)/);
        if (m && parseInt(m[2], 10) === pid)
          ports.push(parseInt(m[1], 10));
      }
    } else if (process.platform === "darwin") {
      const res = await execAsync(
        `lsof -iTCP -sTCP:LISTEN -P -n -a -p ${pid}`,
        { timeout: 6e3, maxBuffer: 1024 * 1024 }
      );
      output2 = String(res.stdout);
      for (const line of output2.split("\n")) {
        const m = line.match(/:(\d+)\s*\(LISTEN\)/);
        if (m)
          ports.push(parseInt(m[1], 10));
      }
    } else {
      const res = await execAsync(
        `ss -tlnp 2>/dev/null | grep "pid=${pid}," || true`,
        { timeout: 6e3, maxBuffer: 1024 * 1024 }
      );
      output2 = String(res.stdout);
      for (const line of output2.split("\n")) {
        const m = line.match(/:(\d+)\s/);
        if (m)
          ports.push(parseInt(m[1], 10));
      }
    }
  } catch {
  }
  return [...new Set(ports)];
}
function lsPost(conn, method, payloadObj) {
  return new Promise((resolve3) => {
    const payload = JSON.stringify(payloadObj ?? {});
    const mod = conn.useTls ? https : http;
    const req = mod.request(
      {
        host: "127.0.0.1",
        port: conn.port,
        path: `/${SERVICE}/${method}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "x-codeium-csrf-token": conn.csrfToken
        },
        rejectUnauthorized: false,
        timeout: 8e3
      },
      (res) => {
        let body = "";
        res.on("data", (c) => body += c.toString());
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve3(body);
          } else {
            resolve3(null);
          }
        });
      }
    );
    req.on("error", () => resolve3(null));
    req.on("timeout", () => {
      req.destroy();
      resolve3(null);
    });
    req.write(payload);
    req.end();
  });
}
async function probePort(port, csrfToken) {
  for (const useTls of [false, true]) {
    const conn = {
      pid: 0,
      port,
      useTls,
      csrfToken,
      cachedAt: Date.now()
    };
    const body = await lsPost(conn, "GetUserStatus", {});
    if (body !== null)
      return conn;
  }
  return null;
}
var LsClient = class {
  constructor(log2 = () => {
  }) {
    this.conn = null;
    this.discovering = null;
    this.log = log2;
  }
  async discover() {
    const proc = await findLsProcess();
    if (!proc) {
      this.log("[LS] no language_server process found");
      return null;
    }
    const listening = await listListeningPorts(proc.pid);
    const candidates = [
      ...proc.extPort ? [proc.extPort] : [],
      ...listening
    ].filter((v, i, a) => a.indexOf(v) === i);
    for (const port of candidates) {
      const conn = await probePort(port, proc.csrfToken);
      if (conn) {
        conn.pid = proc.pid;
        this.log(
          `[LS] connected: pid=${proc.pid} port=${port} tls=${conn.useTls}`
        );
        return conn;
      }
    }
    this.log("[LS] found process but no ConnectRPC port responded");
    return null;
  }
  async getConnection(force = false) {
    if (!force && this.conn && Date.now() - this.conn.cachedAt < 3e4) {
      return this.conn;
    }
    if (this.discovering)
      return this.discovering;
    this.discovering = this.discover().then((c) => {
      this.conn = c;
      this.discovering = null;
      return c;
    });
    return this.discovering;
  }
  async call(method, payload) {
    let conn = await this.getConnection();
    if (!conn)
      return null;
    let body = await lsPost(conn, method, payload);
    if (body === null) {
      conn = await this.getConnection(true);
      if (!conn)
        return null;
      body = await lsPost(conn, method, payload);
    }
    return body;
  }
  async getUserStatus() {
    const body = await this.call("GetUserStatus", {});
    if (!body)
      return null;
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  async getAvailableModels() {
    const body = await this.call("GetAvailableModels", {});
    if (!body)
      return null;
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  async getAllTrajectories() {
    const body = await this.call("GetAllCascadeTrajectories", {});
    if (!body)
      return [];
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return [];
    }
    const summaries = parsed?.trajectorySummaries;
    let list = [];
    if (summaries && typeof summaries === "object" && !Array.isArray(summaries)) {
      list = Object.entries(summaries).map(([cascadeId, s]) => {
        const wsUri = String(
          s?.workspaces?.[0]?.workspaceFolderAbsoluteUri ?? s?.trajectoryMetadata?.workspaces?.[0]?.workspaceFolderAbsoluteUri ?? ""
        );
        return {
          id: cascadeId,
          title: s?.summary ?? s?.title ?? s?.name ?? void 0,
          status: s?.status ?? void 0,
          updatedAt: s?.lastModifiedTime ?? s?.lastUserInputTime ?? s?.createdTime ?? void 0,
          workspaceUri: wsUri || void 0,
          workspaceName: wsUri ? decodeURIComponent(wsUri.split("/").pop() || wsUri) : void 0,
          raw: s
        };
      });
    } else {
      const rawArray = parsed?.trajectories ?? parsed?.cascade_trajectories ?? parsed?.cascades ?? [];
      if (Array.isArray(rawArray)) {
        list = rawArray.map((t) => ({
          id: String(t.cascadeId ?? t.cascade_id ?? t.id ?? t.trajectoryId ?? t._id ?? ""),
          title: t.title ?? t.name ?? t.summary ?? void 0,
          status: t.status ?? t.state ?? void 0,
          updatedAt: t.updatedAt ?? t.updated_at ?? t.lastModified ?? void 0,
          raw: t
        }));
      }
    }
    list.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
    return list;
  }
  async getTrajectory(cascadeId) {
    const body = await this.call("GetCascadeTrajectory", { cascadeId });
    if (!body)
      return null;
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  async cancel(cascadeId) {
    const body = await this.call("CancelCascadeInvocation", { cascadeId });
    return body !== null;
  }
  // Upload an image (base64, no data-uri prefix) as a cascade media artifact.
  // Returns the media entry (mimeType/inlineData/uri/thumbnail/description) the
  // send call needs, or null on failure.
  async saveMediaAsArtifact(base64, mimeType, description) {
    const cleanBase64 = base64.includes(",") ? base64.split(",")[1] : base64;
    const body = await this.call("SaveMediaAsArtifact", {
      media: { mimeType, inlineData: cleanBase64 }
    });
    if (!body)
      return null;
    try {
      const parsed = JSON.parse(body);
      const entry = (Array.isArray(parsed?.media) ? parsed.media[0] : parsed?.media) ?? parsed?.artifact ?? parsed;
      const media = { ...entry };
      if (!media.mimeType)
        media.mimeType = mimeType;
      if (!media.inlineData)
        media.inlineData = base64;
      if (description && !media.description)
        media.description = description;
      return media;
    } catch {
      return { mimeType, inlineData: base64, description };
    }
  }
  // Send a user message (optionally with media) to a cascade. This is the real
  // send RPC — it carries the media array so images arrive as true attachments.
  async sendUserCascadeMessage(cascadeId, text, media, modelId) {
    return this.sendCascadeItems(cascadeId, [{ text }], media, modelId);
  }
  // Lower-level send: pass the raw `items` array so callers can include a slash
  // command ({item:{slashCommand:{info:{…}}}}) or a conversation mention
  // ({item:{conversation:{id,title,lastModifiedTime}}}) alongside text items.
  async sendCascadeItems(cascadeId, items, media, modelId) {
    const fullItems = [...items];
    if (Array.isArray(media) && media.length > 0) {
      for (const m of media) {
        const rawData = m.inlineData || m.data || m.base64;
        const mimeType = m.mimeType || "image/png";
        if (rawData && typeof rawData === "string") {
          const cleanBase64 = rawData.startsWith("data:") ? rawData.split(",")[1] || rawData : rawData;
          fullItems.unshift({
            media: {
              mimeType,
              inlineData: cleanBase64,
              mediaPath: m.mediaPath || m.path || void 0
            }
          });
        }
      }
    }
    const payload = {
      cascadeId,
      items: fullItems,
      cascadeConfig: buildCascadeConfig(modelId),
      conversationHistoryConfig: { enabled: true }
    };
    if (media && media.length)
      payload.media = media;
    const body = await this.call("SendUserCascadeMessage", payload);
    return body !== null;
  }
  // Approve / reject a plan (or any artifact) the agent is waiting feedback on.
  // The IDE sends this through SendUserCascadeMessage with an artifactComments
  // array carrying the artifact URI + approval status. `approved=false` marks it
  // rejected so the agent revises instead of proceeding.
  async approveArtifact(cascadeId, artifactUri, approved, modelId) {
    const body = await this.call("SendUserCascadeMessage", {
      cascadeId,
      cascadeConfig: buildCascadeConfig(modelId),
      conversationHistoryConfig: { enabled: true },
      artifactComments: [
        {
          artifactUri,
          fullFile: {},
          approvalStatus: approved ? "ARTIFACT_APPROVAL_STATUS_APPROVED" : "ARTIFACT_APPROVAL_STATUS_REJECTED"
        }
      ]
    });
    return body !== null;
  }
  // Fetch the available slash commands (goal / schedule / grill-me / learn …)
  // for a cascade. Returns the raw command list ({info,title,description}[]).
  async getSlashCommands(cascadeId, workspaceUris, modelId) {
    const body = await this.call("GetSlashCommands", {
      cascadeId,
      workspaceUris,
      cascadeConfig: buildCascadeConfig(modelId)
    });
    if (!body)
      return [];
    try {
      const parsed = JSON.parse(body);
      return Array.isArray(parsed?.commands) ? parsed.commands : [];
    } catch {
      return [];
    }
  }
  // Answer an ask_question interaction. The agent pauses on an ASK_QUESTION step;
  // this submits the user's selected option ids (and/or free text) so it resumes.
  async handleUserInteraction(cascadeId, trajectoryId, stepIndex, responses) {
    const body = await this.call("HandleCascadeUserInteraction", {
      cascadeId,
      interaction: {
        trajectoryId,
        stepIndex,
        askQuestion: { responses }
      }
    });
    return body !== null;
  }
  // Revert code + conversation back to a specific step (checkpoint). This is
  // the real Antigravity revert: it restores files to the state they were in at
  // that step. Requires an overrideConfig carrying a valid requestedModel.
  async revertToStep(cascadeId, stepIndex, modelId) {
    const body = await this.call("RevertToCascadeStep", {
      cascadeId,
      stepIndex,
      overrideConfig: buildOverrideConfig(modelId)
    });
    return body !== null;
  }
};
function buildCascadeConfig(modelId) {
  return {
    plannerConfig: {
      conversational: {
        plannerMode: "CONVERSATIONAL_PLANNER_MODE_DEFAULT",
        agenticMode: true
      },
      toolConfig: {
        runCommand: {
          autoCommandConfig: {
            autoExecutionPolicy: "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER"
          }
        },
        notifyUser: { artifactReviewMode: "ARTIFACT_REVIEW_MODE_ALWAYS" },
        permissionConfig: { defaultGrants: { ask: ["read_url(*)"] } }
      },
      requestedModel: { model: modelId || "MODEL_PLACEHOLDER_M16" },
      ephemeralMessagesConfig: { enabled: true },
      knowledgeConfig: { enabled: true }
    },
    conversationHistoryConfig: { enabled: true }
  };
}
function buildOverrideConfig(modelId) {
  return {
    plannerConfig: {
      conversational: {
        plannerMode: "CONVERSATIONAL_PLANNER_MODE_DEFAULT",
        agenticMode: true
      },
      toolConfig: {
        runCommand: {
          autoCommandConfig: {
            autoExecutionPolicy: "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER"
          }
        },
        notifyUser: { artifactReviewMode: "ARTIFACT_REVIEW_MODE_ALWAYS" }
      },
      requestedModel: { model: modelId || "MODEL_PLACEHOLDER_M36" },
      ephemeralMessagesConfig: { enabled: true },
      knowledgeConfig: { enabled: true }
    },
    conversationHistoryConfig: { enabled: true }
  };
}
function extractSteps(trajectoryData) {
  const steps = trajectoryData?.trajectory?.steps ?? trajectoryData?.steps ?? [];
  return Array.isArray(steps) ? steps : [];
}
function isGenerating(steps) {
  if (steps.length === 0)
    return false;
  const tail = steps.slice(-8);
  for (const step of tail) {
    const status = String(step.status ?? "").toUpperCase();
    if (status.includes("GENERATING") || status.includes("PENDING") || status.includes("RUNNING")) {
      return true;
    }
  }
  return false;
}

// src/chatController.ts
var vscode = __toESM(require("vscode"));
var fs = __toESM(require("fs"));
var os = __toESM(require("os"));
var path = __toESM(require("path"));

// src/cdpClient.ts
var http2 = __toESM(require("http"));

// node_modules/.pnpm/ws@8.21.1/node_modules/ws/wrapper.mjs
var import_stream = __toESM(require_stream(), 1);
var import_extension = __toESM(require_extension(), 1);
var import_permessage_deflate = __toESM(require_permessage_deflate(), 1);
var import_receiver = __toESM(require_receiver(), 1);
var import_sender = __toESM(require_sender(), 1);
var import_subprotocol = __toESM(require_subprotocol(), 1);
var import_websocket = __toESM(require_websocket(), 1);
var import_websocket_server = __toESM(require_websocket_server(), 1);
var wrapper_default = import_websocket.default;

// src/cdpClient.ts
function httpJson(port, path7, timeoutMs = 2500) {
  return new Promise((resolve3, reject) => {
    const req = http2.get(
      { host: "127.0.0.1", port, path: path7, timeout: timeoutMs },
      (res) => {
        let body = "";
        res.on("data", (c) => body += c.toString());
        res.on("end", () => {
          try {
            resolve3(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
}
async function probePort2(port) {
  try {
    const v = await httpJson(port, "/json/version", 1500);
    return Boolean(v && (v.Browser || v.webSocketDebuggerUrl));
  } catch {
    return false;
  }
}
async function discoverPort(preferred) {
  const candidates = [];
  if (preferred && preferred > 0)
    candidates.push(preferred);
  const envPort = parseInt(process.env.ANTIGRAVITY_REMOTE_DEBUG_PORT ?? "", 10);
  if (!isNaN(envPort))
    candidates.push(envPort);
  for (let p = 9222; p <= 9232; p++)
    candidates.push(p);
  const seen = /* @__PURE__ */ new Set();
  for (const p of candidates) {
    if (seen.has(p))
      continue;
    seen.add(p);
    if (await probePort2(p))
      return p;
  }
  return null;
}
async function listTargets(port) {
  const list = await httpJson(port, "/json/list");
  return Array.isArray(list) ? list : [];
}
function pickWorkbench(targets) {
  const pages = targets.filter(
    (t) => t.type === "page" && t.webSocketDebuggerUrl && !t.url.startsWith("devtools://")
  );
  const wb = pages.find(
    (t) => /workbench\.(esm\.)?html/i.test(t.url) || /workbench/i.test(t.title)
  );
  return wb ?? pages[0] ?? null;
}
var CdpSession = class {
  constructor(wsUrl, log2 = () => {
  }) {
    this.ws = null;
    this.nextId = 1;
    this.pending = /* @__PURE__ */ new Map();
    this.wsUrl = wsUrl;
    this.log = log2;
  }
  connect() {
    return new Promise((resolve3, reject) => {
      const ws = new wrapper_default(this.wsUrl, {
        perMessageDeflate: false,
        maxPayload: 64 * 1024 * 1024
      });
      this.ws = ws;
      const to = setTimeout(() => {
        reject(new Error("CDP connect timeout"));
        ws.terminate();
      }, 5e3);
      ws.on("open", () => {
        clearTimeout(to);
        resolve3();
      });
      ws.on("message", (data) => this.onMessage(data.toString()));
      ws.on("error", (e) => {
        clearTimeout(to);
        this.log(`[cdp] ws error: ${e.message}`);
        reject(e);
      });
      ws.on("close", () => {
        for (const { reject: rej } of this.pending.values()) {
          rej(new Error("CDP connection closed"));
        }
        this.pending.clear();
        this.ws = null;
      });
    });
  }
  get connected() {
    return this.ws?.readyState === wrapper_default.OPEN;
  }
  onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const call = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error)
        call.reject(new Error(msg.error.message ?? "CDP error"));
      else
        call.resolve(msg.result);
    }
  }
  send(method, params = {}) {
    if (!this.connected)
      return Promise.reject(new Error("CDP not connected"));
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve3, reject) => {
      this.pending.set(id, { resolve: resolve3, reject });
      this.ws.send(payload, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP ${method} timeout`));
        }
      }, 15e3);
    });
  }
  /** Evaluate an expression in the page and return the JS value. */
  async evaluate(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      allowUnsafeEvalBlockedByCSP: true,
      userGesture: true
    });
    if (res?.exceptionDetails) {
      throw new Error(
        res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? "evaluate failed"
      );
    }
    return res?.result?.value;
  }
  close() {
    try {
      this.ws?.close();
    } catch {
    }
    this.ws = null;
  }
};
var CdpClient = class {
  constructor(log2 = () => {
  }) {
    this.session = null;
    this.port = 0;
    this.log = log2;
  }
  get activePort() {
    return this.port;
  }
  isConnected() {
    return this.session?.connected ?? false;
  }
  /** Connect to the workbench renderer via the given/discovered port. */
  async connect(preferredPort) {
    if (this.session?.connected)
      return true;
    const port = await discoverPort(preferredPort);
    if (!port) {
      this.log("[cdp] no remote-debugging port found");
      return false;
    }
    this.port = port;
    let targets;
    try {
      targets = await listTargets(port);
    } catch (e) {
      this.log(`[cdp] listTargets failed: ${e.message}`);
      return false;
    }
    const wb = pickWorkbench(targets);
    if (!wb?.webSocketDebuggerUrl) {
      this.log("[cdp] no workbench target found");
      return false;
    }
    this.session = new CdpSession(wb.webSocketDebuggerUrl, this.log);
    try {
      await this.session.connect();
      await this.session.send("Runtime.enable", {});
      this.log(`[cdp] connected to workbench on port ${port}`);
      return true;
    } catch (e) {
      this.log(`[cdp] connect failed: ${e.message}`);
      this.session = null;
      return false;
    }
  }
  disconnect() {
    this.session?.close();
    this.session = null;
  }
  async ensure() {
    if (this.session?.connected)
      return true;
    return this.connect(this.port || void 0);
  }
  /**
   * Capture a screenshot of the IDE workbench window as a PNG (base64, no
   * data-uri prefix). Uses CDP Page.captureScreenshot on the workbench target.
   */
  async captureScreenshot() {
    if (!await this.ensure())
      return null;
    try {
      await this.session.send("Page.enable", {});
      const res = await this.session.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false
      });
      const data = res?.data;
      return typeof data === "string" && data.length ? data : null;
    } catch (e) {
      this.log(`[cdp] captureScreenshot failed: ${e.message}`);
      return null;
    }
  }
  /**
   * Read the rendered chat transcript from the DOM. We look for the same
   * containers the IDE uses for chat content and return them in order.
   */
  async readMessages() {
    if (!await this.ensure())
      return null;
    const expr = `(() => {
      const out = [];
      const sels = [
        '.chat-message', '[data-message-role]',
        '.markdown-body', '.rendered-markdown', '.chat-message-content'
      ];
      let nodes = [];
      for (const s of sels) {
        const found = document.querySelectorAll(s);
        if (found.length) { nodes = Array.from(found); break; }
      }
      for (const n of nodes) {
        const roleAttr = (n.getAttribute && (n.getAttribute('data-message-role') ||
          n.getAttribute('data-role'))) || '';
        let role = /user/i.test(roleAttr) ? 'user'
          : /assistant|ai|model/i.test(roleAttr) ? 'assistant'
          : (n.closest && n.closest('[data-message-role="user"]')) ? 'user'
          : 'assistant';
        const text = (n.innerText || '').trim();
        if (text) out.push({ role, text });
      }
      return out;
    })()`;
    try {
      return await this.session.evaluate(expr);
    } catch (e) {
      this.log(`[cdp] readMessages failed: ${e.message}`);
      return null;
    }
  }
  /** Whether the panel currently shows a "generating/stop" affordance. */
  async isGenerating() {
    if (!await this.ensure())
      return false;
    const expr = `(() => {
      const stop = document.querySelector(
        '[aria-label*="Stop" i], [title*="Stop" i], .codicon-debug-stop, .generating, [data-generating="true"]'
      );
      return !!stop;
    })()`;
    try {
      return await this.session.evaluate(expr);
    } catch {
      return false;
    }
  }
  /**
   * Type a message into the chat composer and submit it. We set the value on
   * the textarea/contenteditable, dispatch input events so the framework
   * registers it, then press Enter.
   */
  async sendMessage(text) {
    if (!await this.ensure())
      return false;
    const json = JSON.stringify(text);
    const expr = `(() => {
      const box = document.querySelector(
        'textarea[placeholder], .chat-input textarea, [contenteditable="true"].chat-input, .inputarea, [role="textbox"]'
      );
      if (!box) return false;
      const val = ${json};
      if (box.tagName === 'TEXTAREA' || box.tagName === 'INPUT') {
        const setter = Object.getOwnPropertyDescriptor(box.__proto__, 'value')?.set;
        setter ? setter.call(box, val) : (box.value = val);
        box.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        box.focus();
        box.textContent = val;
        box.dispatchEvent(new InputEvent('input', { bubbles: true }));
      }
      box.focus();
      const ev = (type) => box.dispatchEvent(new KeyboardEvent(type, {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
      }));
      ev('keydown'); ev('keypress'); ev('keyup');
      return true;
    })()`;
    try {
      return await this.session.evaluate(expr);
    } catch (e) {
      this.log(`[cdp] sendMessage failed: ${e.message}`);
      return false;
    }
  }
  /**
   * Best-effort model selection through the webview. The Cascade model picker
   * lives in the renderer, so we try to find a menu/button whose text matches
   * the model label and click it. This is inherently fragile (depends on the
   * IDE's DOM), so callers must not rely on the return value for correctness.
   */
  async selectModel(modelLabel) {
    if (!await this.ensure())
      return false;
    const json = JSON.stringify(modelLabel);
    const expr = `(() => {
      const want = ${json};
      const norm = (s) => (s || '').toLowerCase().replace(/\\s+/g, ' ').trim();
      const target = norm(want);

      function searchDoc(root) {
        if (!root) return null;
        const nodes = Array.from(root.querySelectorAll('button, div, span, [role="button"], [role="menuitem"], [role="option"]'));
        for (const n of nodes) {
          const t = norm(n.innerText || n.textContent || n.getAttribute('title') || n.getAttribute('aria-label'));
          if (t && (t === target || t.includes(target) || target.includes(t))) {
            return n;
          }
        }
        const allElements = root.querySelectorAll('*');
        for (const el of allElements) {
          if (el.shadowRoot) {
            const found = searchDoc(el.shadowRoot);
            if (found) return found;
          }
        }
        const iframes = root.querySelectorAll('iframe, webview');
        for (const f of iframes) {
          try {
            const doc = f.contentDocument || (f.contentWindow && f.contentWindow.document);
            if (doc) {
              const found = searchDoc(doc);
              if (found) return found;
            }
          } catch {}
        }
        return null;
      }

      function clickDropdown(root) {
        if (!root) return false;
        const triggers = Array.from(root.querySelectorAll('button, div, span')).filter((el) => {
          const cl = String(el.className || '').toLowerCase();
          const tt = String(el.getAttribute('title') || '').toLowerCase();
          const al = String(el.getAttribute('aria-label') || '').toLowerCase();
          const txt = norm(el.innerText || el.textContent);
          return (cl.includes('model') || tt.includes('model') || al.includes('model') || txt.includes('sonnet') || txt.includes('gemini') || txt.includes('gpt'));
        });
        if (triggers.length > 0) {
          try { (triggers[0]).click(); return true; } catch {}
        }
        const allElements = root.querySelectorAll('*');
        for (const el of allElements) {
          if (el.shadowRoot && clickDropdown(el.shadowRoot)) return true;
        }
        return false;
      }

      clickDropdown(document);

      const hit = searchDoc(document);
      if (hit) {
        try { (hit).click(); return true; } catch {}
      }
      return false;
    })()`;
    try {
      return await this.session.evaluate(expr);
    } catch (e) {
      this.log(`[cdp] selectModel failed: ${e.message}`);
      return false;
    }
  }
};

// src/chatController.ts
var ChatController = class {
  constructor(ls2, log2 = () => {
  }) {
    this.listeners = /* @__PURE__ */ new Set();
    this.activeCascadeId = "";
    this.lastStatusText = "";
    this.lastGenerating = false;
    this.pollTimer = null;
    this.lastStepSig = "";
    // Throttle + dedupe the trajectory-list re-emit inside the poll so renames
    // and newly-created conversations appear without a manual refresh.
    this.lastTrajRefresh = 0;
    this.lastTrajSig = "";
    // CDP is the preferred transport: driving/reading the chat through the IDE's
    // remote-debugging port keeps the IDE panel and the web UI perfectly in sync
    // (both usable at once). When CDP is unavailable we fall back to VS Code
    // commands (drive) + the LS trajectory (read).
    this.cdpReady = false;
    this.preferredDebugPort = 0;
    this.lastCdpSig = "";
    // Remembered model preference (LS has no set-model RPC; we persist the user's
    // choice and mark it selected in the list + attempt it via CDP).
    this.selectedModelId = "";
    // Sticky selection: once the user picks a conversation or creates a new one,
    // the poller must NOT auto-jump back to whatever cascade happens to be RUNNING
    // (an older long-running chat). We only auto-resolve when nothing is chosen.
    this.userSelected = false;
    // Pending "new chat": startNewConversation doesn't create a trajectory until
    // the first message is sent, so we show an empty transcript and suppress the
    // poller until a brand-new cascade id appears (or the user sends a message).
    this.pendingNewChat = false;
    this.knownIdsAtNewChat = /* @__PURE__ */ new Set();
    this.ls = ls2;
    this.log = log2;
    this.cdp = new CdpClient(log2);
  }
  /** Try to attach to the IDE's remote-debugging port. Safe to call repeatedly. */
  async connectCdp(preferredPort) {
    if (preferredPort)
      this.preferredDebugPort = preferredPort;
    this.cdpReady = await this.cdp.connect(this.preferredDebugPort || void 0);
    this.log(`[chat] CDP ${this.cdpReady ? "connected" : "unavailable"}`);
    return this.cdpReady;
  }
  cdpConnected() {
    return this.cdpReady && this.cdp.isConnected();
  }
  cdpPort() {
    return this.cdp.activePort;
  }
  // Capture a screenshot of the IDE workbench window (PNG base64, no data-uri
  // prefix). Requires the CDP connection; returns null if unavailable.
  async captureScreenshot() {
    if (!this.cdpConnected()) {
      this.cdpReady = await this.cdp.connect(this.preferredDebugPort || void 0);
      if (!this.cdpConnected())
        return null;
    }
    return this.cdp.captureScreenshot();
  }
  onEvent(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit(e) {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
      }
    }
  }
  async getState() {
    return this.buildState();
  }
  start() {
    if (this.pollTimer)
      return;
    this.pollTimer = setInterval(() => this.poll().catch(() => {
    }), 600);
  }
  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
  // ---- Discover the currently active cascade id ----
  // LS is the source of truth: GetAllCascadeTrajectories returns the same data
  // the IDE panel renders, so picking from it keeps IDE and web in sync.
  async resolveActiveCascadeId() {
    if (this.userSelected && this.activeCascadeId)
      return this.activeCascadeId;
    const list = await this.ls.getAllTrajectories();
    if (list.length > 0) {
      const running2 = list.find(
        (t) => String(t.status ?? "").toUpperCase().includes("RUNNING")
      );
      this.activeCascadeId = (running2 ?? list[0]).id;
      return this.activeCascadeId;
    }
    try {
      const diag = await vscode.commands.executeCommand(
        "antigravity.getDiagnostics"
      );
      const id = diag?.recentTrajectories?.[0]?.googleAgentId ?? diag?.recentTrajectories?.[0]?.cascadeId ?? "";
      if (id)
        this.activeCascadeId = String(id);
    } catch {
    }
    return this.activeCascadeId;
  }
  getActiveCascadeId() {
    return this.activeCascadeId;
  }
  // ---- Actions ----
  async newChat() {
    this.knownIdsAtNewChat = new Set(
      (await this.ls.getAllTrajectories()).map((t) => t.id)
    );
    await vscode.commands.executeCommand("antigravity.startNewConversation");
    this.pendingNewChat = true;
    this.userSelected = true;
    this.activeCascadeId = "";
    this.lastStepSig = "";
    this.lastCdpSig = "";
    this.lastGenerating = false;
    this.lastStatusText = "Idle";
    this.log("[chat] new chat: entering pending (empty) state");
    this.emit({
      type: "state",
      state: { cascadeId: "", generating: false, statusText: "Idle", messages: [] }
    });
  }
  /** After a message is sent in a pending new chat, adopt the new cascade id. */
  async adoptNewCascadeIfPending() {
    if (!this.pendingNewChat)
      return;
    for (let i = 0; i < 15; i++) {
      await delay(300);
      const list = await this.ls.getAllTrajectories();
      const fresh = list.find((t) => !this.knownIdsAtNewChat.has(t.id));
      if (fresh) {
        this.activeCascadeId = fresh.id;
        this.pendingNewChat = false;
        this.log(`[chat] pending new chat adopted -> ${fresh.id}`);
        await this.pushFullState();
        return;
      }
    }
    this.pendingNewChat = false;
    this.log("[chat] pending new chat: no fresh id appeared");
  }
  async sendMessage(text, images) {
    if (!text.trim() && (!images || images.length === 0))
      return;
    this.userSelected = true;
    const id = this.activeCascadeId || await this.resolveActiveCascadeId();
    const model = this.selectedModelId || await this.detectActiveModel() || "MODEL_PLACEHOLDER_M16";
    let sent = false;
    const mediaItems = (images || []).map((b64) => {
      let mimeType = "image/png";
      let base64 = b64;
      const m = b64.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (m) {
        mimeType = m[1];
        base64 = m[2];
      }
      return { inlineData: { mimeType, data: base64 } };
    });
    if (id) {
      try {
        sent = await this.ls.sendUserCascadeMessage(id, text, mediaItems, model);
        if (sent)
          this.log(`[chat] sent via LS RPC (model: ${model})`);
        else
          this.log(`[chat] LS RPC send failed; trying CDP/commands`);
      } catch (e) {
        this.log(`[chat] LS send error: ${e?.message ?? e}`);
      }
    }
    if (!sent && this.cdpConnected()) {
      sent = await this.cdp.sendMessage(text);
      if (sent)
        this.log("[chat] sent via CDP");
      else
        this.log("[chat] CDP send failed; falling back to commands");
    }
    if (!sent) {
      try {
        await vscode.commands.executeCommand(
          "workbench.action.focusActiveEditorGroup"
        );
      } catch {
      }
      try {
        await vscode.commands.executeCommand(
          "antigravity.sendPromptToAgentPanel",
          text
        );
        sent = true;
      } catch {
        sent = false;
      }
      if (!sent) {
        await vscode.commands.executeCommand("antigravity.sendTextToChat", text);
      }
    }
    if (this.pendingNewChat) {
      await this.adoptNewCascadeIfPending();
    } else {
      this.lastStepSig = "";
      await this.pushFullState();
    }
  }
  // Note: Media sending has been removed per user request.
  async sendWithMedia(text, images) {
    await this.sendMessage(text);
  }
  // Send a message built from arbitrary items — used for slash commands and
  // conversation mentions, which are special item shapes the IDE composer emits:
  //   slash command → { item: { slashCommand: { info: {...} } } }
  //   conversation  → { item: { conversation: { id, title, lastModifiedTime } } }
  // followed by a trailing { text } item. Falls back to plain text on failure.
  async sendItems(items, fallbackText) {
    this.userSelected = true;
    const id = this.activeCascadeId || await this.resolveActiveCascadeId();
    if (!id) {
      await this.sendMessage(fallbackText);
      return;
    }
    const model = this.selectedModelId || await this.detectActiveModel() || "MODEL_PLACEHOLDER_M16";
    const ok = await this.ls.sendCascadeItems(id, items, [], model);
    if (!ok) {
      await this.sendMessage(fallbackText);
      return;
    }
    if (this.pendingNewChat) {
      await this.adoptNewCascadeIfPending();
    } else {
      this.lastStepSig = "";
      await this.pushFullState();
    }
  }
  // Invoke a system slash command (grill-me / goal / schedule / learn …). The
  // command's modelFacingText is what actually steers the agent; the visible
  // text is appended as a trailing item.
  async sendSlashCommand(name, modelFacingText, text = "") {
    await this.sendItems(
      [
        {
          item: {
            slashCommand: {
              info: { name, modelFacingText, type: "SLASH_COMMAND_TYPE_SYSTEM" }
            }
          }
        },
        // The IDE composer separates the command from the user's text with a
        // leading space (e.g. " làm tiếp"). Preserve that so the message reads
        // naturally; an empty text still sends a lone space (command only).
        { text: text ? ` ${text}` : " " }
      ],
      text || name
    );
  }
  // Mention a previous conversation in the current chat so the agent can pull in
  // its context. `conv` carries the referenced cascade's id/title/time.
  async sendWithConversationMention(conv, text) {
    await this.sendItems(
      [
        {
          item: {
            conversation: {
              id: conv.id,
              title: conv.title ?? "",
              lastModifiedTime: conv.lastModifiedTime ?? ""
            }
          }
        },
        { text: text || " " }
      ],
      text
    );
  }
  async switchCascade(id) {
    if (!id)
      return;
    this.userSelected = true;
    this.pendingNewChat = false;
    try {
      await vscode.commands.executeCommand(
        "workbench.action.smartFocusConversation",
        id
      );
    } catch {
      try {
        await vscode.commands.executeCommand(
          "workbench.action.forceFocusManager",
          id
        );
      } catch {
      }
    }
    this.activeCascadeId = id;
    this.lastStepSig = "";
    this.lastCdpSig = "";
    await this.pushFullState();
  }
  async cancel() {
    const id = this.activeCascadeId || await this.resolveActiveCascadeId();
    if (!id)
      return false;
    return this.ls.cancel(id);
  }
  // Real revert: Antigravity's RevertToCascadeStep RPC rolls the workspace code
  // back to the checkpoint at a given trajectory step (each user turn is a
  // checkpoint). This actually restores files — it does NOT just ask the agent.
  // stepIndex comes from the user message's sourceTrajectoryStepInfo.stepIndex.
  async revertToStep(stepIndex) {
    const id = this.activeCascadeId || await this.resolveActiveCascadeId();
    if (!id || stepIndex == null || stepIndex < 0)
      return false;
    await this.cancel();
    await delay(150);
    const model = this.selectedModelId || await this.detectActiveModel() || "MODEL_PLACEHOLDER_M36";
    const ok = await this.ls.revertToStep(id, stepIndex, model);
    this.lastStepSig = "";
    await this.pushFullState();
    this.log(`[chat] revert to step ${stepIndex} -> ${ok ? "ok" : "failed"}`);
    return ok;
  }
  // Revert to the most recent user turn (for the Telegram /revert command,
  // which has no per-message UI). Finds the last USER_INPUT step and reverts to
  // the checkpoint just before it.
  async revertLatest() {
    const id = this.activeCascadeId || await this.resolveActiveCascadeId();
    if (!id)
      return false;
    const data = await this.ls.getTrajectory(id);
    const steps = extractSteps(data);
    let stepIndex = -1;
    for (const step of steps) {
      const type = shortType(step.type);
      const idx = step.metadata?.sourceTrajectoryStepInfo?.stepIndex;
      if (type === "USER_INPUT" && typeof idx === "number")
        stepIndex = idx;
    }
    if (stepIndex < 0)
      return false;
    return this.revertToStep(stepIndex);
  }
  getTodayStats() {
    const s = loadTodayStats();
    return {
      totalChats: s.totalChats,
      totalTokens: s.totalTokens,
      totalDurationMs: s.totalDurationMs
    };
  }
  resetTodayStats() {
    const s = resetTodayStatsFile();
    return {
      totalChats: s.totalChats,
      totalTokens: s.totalTokens,
      totalDurationMs: s.totalDurationMs
    };
  }
  // Answer an ask_question interaction. `answers` maps question index → chosen
  // option ids (+ optional free text). We rebuild the full responses[] the LS
  // expects (echoing the questions/options) so the agent resumes.
  async answerQuestion(stepIndex, answers) {
    const id = this.activeCascadeId || await this.resolveActiveCascadeId();
    if (!id)
      return false;
    const data = await this.ls.getTrajectory(id);
    const trajectoryId = String(data?.trajectory?.trajectoryId ?? "");
    const steps = extractSteps(data);
    let step = steps.find(
      (s, idx) => s?.metadata?.sourceTrajectoryStepInfo?.stepIndex === stepIndex || s?.stepIndex === stepIndex || s?.step_index === stepIndex || idx === stepIndex
    );
    if (!step && steps.length > 0)
      step = steps[steps.length - 1];
    const realStepIndex = step?.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? step?.stepIndex ?? step?.step_index ?? stepIndex;
    const aq = step?.askQuestion ?? step?.requestedInteraction?.askQuestion ?? step?.askPermission;
    const questions = Array.isArray(aq?.questions) ? aq.questions : [];
    const responses = (questions.length > 0 ? questions : answers).map((q, i) => {
      const a = answers[i] ?? { selectedOptionIds: [] };
      const r = {
        question: typeof q === "string" ? q : q?.question ?? "",
        options: q?.options ?? []
      };
      if (Array.isArray(a.selectedOptionIds) && a.selectedOptionIds.length > 0) {
        r.selectedOptionIds = a.selectedOptionIds;
      }
      if (a.freeText) {
        r.writeInResponse = a.freeText;
      }
      return r;
    });
    const ok = await this.ls.handleUserInteraction(id, trajectoryId, realStepIndex, responses);
    this.lastStepSig = "";
    await this.pushFullState();
    this.log(`[chat] answer question step ${stepIndex} (real: ${realStepIndex}) -> ${ok ? "ok" : "failed"}`);
    return ok;
  }
  // Skip an ask_question interaction (equivalent to the IDE's "skip" — send
  // empty selections so the agent proceeds with its recommendation).
  async skipQuestion(stepIndex) {
    const id = this.activeCascadeId || await this.resolveActiveCascadeId();
    if (!id)
      return false;
    const data = await this.ls.getTrajectory(id);
    const trajectoryId = String(data?.trajectory?.trajectoryId ?? "");
    if (!trajectoryId)
      return false;
    const steps = extractSteps(data);
    const step = steps.find(
      (s) => s?.metadata?.sourceTrajectoryStepInfo?.stepIndex === stepIndex
    );
    const aq = step?.askQuestion ?? step?.requestedInteraction?.askQuestion;
    const questions = Array.isArray(aq?.questions) ? aq.questions : [];
    const responses = questions.map((q) => ({
      question: q?.question ?? "",
      options: q?.options ?? [],
      selectedOptionIds: [],
      skipped: true
    }));
    const ok = await this.ls.handleUserInteraction(id, trajectoryId, stepIndex, responses);
    this.lastStepSig = "";
    await this.pushFullState();
    return ok;
  }
  // Fetch the dynamic slash-command catalog for the active cascade.
  async getSlashCommands() {
    const id = this.activeCascadeId || await this.resolveActiveCascadeId();
    if (!id)
      return [];
    const data = await this.ls.getTrajectory(id);
    const uris = data?.trajectory?.metadata?.workspaceUris ?? data?.trajectory?.metadata?.workspaces?.map(
      (w) => w?.workspaceFolderAbsoluteUri
    ).filter(Boolean) ?? [];
    const model = this.selectedModelId || await this.detectActiveModel() || "MODEL_PLACEHOLDER_M16";
    return this.ls.getSlashCommands(id, uris, model);
  }
  // Approve or reject a plan artifact (implementation_plan.md etc). The IDE
  // records an artifactComment with the approval status via SendUserCascadeMessage.
  async approvePlan(artifactUri, approved) {
    const id = this.activeCascadeId || await this.resolveActiveCascadeId();
    if (!id)
      return false;
    const model = this.selectedModelId || await this.detectActiveModel() || "MODEL_PLACEHOLDER_M16";
    const ok = await this.ls.approveArtifact(id, artifactUri, approved, model);
    this.lastStepSig = "";
    await this.pushFullState();
    this.log(`[chat] ${approved ? "approve" : "reject"} plan -> ${ok ? "ok" : "failed"}`);
    return ok;
  }
  async getTrajectories() {
    const list = await this.ls.getAllTrajectories();
    this.emit({ type: "trajectories", list });
    return list;
  }
  // Quota comes from GetUserStatus.planStatus (prompt/flow credits) plus the
  // per-model quotaInfo (remainingFraction + resetTime) from the model configs.
  async getQuota() {
    const status = await this.ls.getUserStatus();
    if (!status)
      return null;
    const us = status.userStatus ?? status;
    const plan = us?.planStatus ?? {};
    const info = plan?.planInfo ?? {};
    const credits = {
      promptCredits: {
        available: numOr(plan?.availablePromptCredits),
        monthly: numOr(info?.monthlyPromptCredits)
      },
      flowCredits: {
        available: numOr(plan?.availableFlowCredits),
        monthly: numOr(info?.monthlyFlowCredits)
      }
    };
    const models = await this.getModels();
    const modelQuota = models.filter((m) => m.remainingFraction != null).map((m) => ({
      label: m.label,
      remainingFraction: m.remainingFraction,
      resetTime: m.resetTime
    }));
    return {
      plan: info?.planName ?? us?.userTier?.tier ?? "\u2014",
      account: { name: us?.name, email: us?.email },
      credits,
      modelQuota
    };
  }
  // Model list comes from GetUserStatus.cascadeModelConfigData.clientModelConfigs
  // — this is exactly the picker shown in the Cascade chat box (nice labels,
  // per-model quota, recommended flag). Falls back to GetAvailableModels.
  async getModels() {
    const status = await this.ls.getUserStatus();
    const us = status?.userStatus ?? status;
    const configs = us?.cascadeModelConfigData?.clientModelConfigs;
    const activeModel = await this.detectActiveModel();
    if (Array.isArray(configs) && configs.length > 0) {
      return configs.map((c) => {
        const mid = String(c?.modelOrAlias?.model ?? "");
        const alias = String(c?.modelOrAlias?.alias ?? "");
        const label = String(c?.label ?? "");
        const id = mid || alias || label;
        const isSel = this.selectedModelId ? this.selectedModelId === id || this.selectedModelId === mid || this.selectedModelId === alias || this.selectedModelId === label : activeModel ? activeModel === mid || activeModel === alias || activeModel === label || activeModel === id : Boolean(c?.isRecommended);
        return {
          id,
          label: label || mid || alias,
          recommended: Boolean(c?.isRecommended),
          selected: isSel,
          remainingFraction: c?.quotaInfo?.remainingFraction,
          resetTime: c?.quotaInfo?.resetTime
        };
      });
    }
    const avail = await this.ls.getAvailableModels();
    const map = avail?.response?.models ?? avail?.models;
    if (map && typeof map === "object") {
      return Object.entries(map).filter(([, m]) => m?.displayName).map(([key, m]) => ({
        id: String(m?.model ?? key),
        label: String(m?.displayName ?? key),
        recommended: Boolean(m?.recommended),
        selected: this.selectedModelId === String(m?.model ?? key),
        remainingFraction: m?.quotaInfo?.remainingFraction,
        resetTime: m?.quotaInfo?.resetTime
      }));
    }
    return [];
  }
  /** Detect the model the active conversation is actually running, by reading
   * the latest planner step's requestedModel/generatorModel from its trajectory. */
  async detectActiveModel() {
    const id = this.activeCascadeId;
    if (!id)
      return "";
    try {
      const data = await this.ls.getTrajectory(id);
      const steps = extractSteps(data);
      for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i];
        const md = step?.metadata;
        const pr = step?.plannerResponse;
        const m = pr?.requestedModel?.model || pr?.generatorModel || pr?.model || md?.requestedModel?.model || md?.generatorModel || md?.model || "";
        if (m)
          return String(m);
      }
    } catch {
    }
    return "";
  }
  async selectModel(modelId) {
    this.selectedModelId = modelId;
    if (this.cdpConnected()) {
      try {
        await this.cdp.selectModel(modelId);
      } catch {
      }
    }
    const candidates = [
      "antigravity.selectModel",
      "antigravity.setModel",
      "windsurf.selectModel"
    ];
    for (const cmd of candidates) {
      try {
        await vscode.commands.executeCommand(cmd, modelId);
        break;
      } catch {
      }
    }
    await this.pushFullState();
    return true;
  }
  // ---- Reading the conversation ----
  //
  // The Language Server trajectory is the source of truth: it exposes the full
  // structured conversation (GetCascadeTrajectory) in the exact shape the IDE
  // stores it. CDP DOM scraping proved unreliable across IDE builds, so CDP is
  // used only for *sending* (to keep the IDE composer in sync) — never reading.
  async buildState(cascadeId) {
    if (cascadeId) {
      this.userSelected = true;
      this.pendingNewChat = false;
      this.activeCascadeId = cascadeId;
    }
    const id = cascadeId || this.activeCascadeId || await this.resolveActiveCascadeId();
    const data = id ? await this.ls.getTrajectory(id) : null;
    const steps = extractSteps(data);
    const generating = isGenerating(steps);
    const statusText = describeStatus(steps);
    const messages = stepsToMessages(steps, id || void 0);
    if (id)
      accumulateStatsFromSteps(id, steps, (s) => this.emit({ type: "stats_update", stats: s }));
    return { cascadeId: id, generating, statusText, messages };
  }
  async pushFullState() {
    const state = await this.buildState();
    this.emit({ type: "state", state });
  }
  async poll() {
    const now = Date.now();
    if (now - this.lastTrajRefresh > 4e3) {
      this.lastTrajRefresh = now;
      this.ls.getAllTrajectories().then((list) => {
        const sig2 = list.map((t) => `${t.id}:${t.title ?? ""}:${t.status ?? ""}`).join("|");
        if (sig2 !== this.lastTrajSig) {
          this.lastTrajSig = sig2;
          this.emit({ type: "trajectories", list });
        }
      }).catch(() => {
      });
    }
    if (this.pendingNewChat)
      return;
    const id = this.activeCascadeId || await this.resolveActiveCascadeId();
    if (!id)
      return;
    const data = await this.ls.getTrajectory(id);
    if (!data)
      return;
    const steps = extractSteps(data);
    const messages = stepsToMessages(steps);
    const generating = isGenerating(steps);
    const statusText = describeStatus(steps);
    accumulateStatsFromSteps(id, steps, (s) => this.emit({ type: "stats_update", stats: s }));
    const last = messages[messages.length - 1];
    const sig = `${generating}|${messages.length}|${last ? `${last.role}:${last.text.length}` : ""}`;
    if (sig !== this.lastStepSig) {
      const oldSigParts = this.lastStepSig.split("|");
      const newSigParts = sig.split("|");
      if (this.lastStepSig && oldSigParts[0] === newSigParts[0] && oldSigParts[1] === newSigParts[1] && last && oldSigParts[2] && last.role === oldSigParts[2].split(":")[0]) {
        this.lastStepSig = sig;
        this.emit({ type: "state_update", cascadeId: id, generating, statusText, lastMessage: last });
      } else {
        this.lastStepSig = sig;
        this.emit({
          type: "state",
          state: { cascadeId: id, generating, statusText, messages }
        });
      }
    }
    if (generating !== this.lastGenerating || statusText !== this.lastStatusText) {
      this.lastGenerating = generating;
      this.lastStatusText = statusText;
      this.emit({ type: "status", cascadeId: id, generating, statusText });
    }
  }
};
function shortType(rawType) {
  return String(rawType ?? "").toUpperCase().replace(/^CORTEX_STEP_TYPE_/, "");
}
function toolArgs(step) {
  const tc = step?.plannerResponse?.toolCalls?.[0] ?? step?.metadata?.toolCall ?? null;
  if (!tc)
    return {};
  try {
    return tc.argumentsJson ? JSON.parse(tc.argumentsJson) : {};
  } catch {
    return {};
  }
}
function baseName(p) {
  if (!p)
    return "";
  return decodeURIComponent(String(p).split(/[\\/]/).pop() || p);
}
function stepDurationMs(step) {
  const m = step?.metadata;
  const start = m?.startedAt ? Date.parse(m.startedAt) : NaN;
  if (!Number.isFinite(start))
    return null;
  const end = m?.completedAt ? Date.parse(m.completedAt) : Date.now();
  const ms = end - start;
  return ms > 0 ? ms : null;
}
function diffStats(step) {
  const lines = step?.codeAction?.actionResult?.edit?.diff?.unifiedDiff?.lines;
  if (!Array.isArray(lines))
    return null;
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    const t = String(l?.type ?? "");
    if (t.endsWith("INSERT"))
      added++;
    else if (t.endsWith("DELETE"))
      removed++;
  }
  if (added === 0 && removed === 0)
    return null;
  return { added, removed };
}
function toolInfo(step) {
  const type = shortType(step.type);
  const args = toolArgs(step);
  switch (type) {
    case "VIEW_FILE":
      return { kind: "read", verb: "Read", detail: baseName(args.AbsolutePath || args.Path || "") };
    case "GREP_SEARCH":
      return { kind: "search", verb: "Searched", detail: String(args.Query || "").slice(0, 60) };
    case "LIST_DIRECTORY":
      return { kind: "read", verb: "Listed", detail: baseName(args.DirectoryPath || "") };
    case "RUN_COMMAND":
      return { kind: "run", verb: "Ran", detail: String(args.CommandLine || "").replace(/\s+/g, " ").slice(0, 70) };
    case "CODE_ACTION":
    case "REPLACE_FILE_CONTENT":
    case "MULTI_REPLACE_FILE_CONTENT":
      return { kind: "edit", verb: "Edited", detail: baseName(args.AbsolutePath || args.TargetFile || args?.ArtifactMetadata?.Summary || "") };
    case "MANAGE_TASK":
      return { kind: "task", verb: "Task", detail: String(args.toolSummary || "").slice(0, 60) };
    default: {
      const summary = args.toolSummary || args.toolAction || "";
      return { kind: "tool", verb: summary ? String(summary) : titleCase(type), detail: "" };
    }
  }
}
function describeStatus(steps) {
  if (steps.length === 0)
    return "Idle";
  const last = steps[steps.length - 1];
  const type = shortType(last.type);
  if (type === "PLANNER_RESPONSE")
    return "Thinking";
  const info = toolInfo(last);
  return info.detail ? `${info.verb} ${info.detail}` : info.verb;
}
function isPlanStep(step) {
  const args = toolArgs(step);
  const meta = args?.ArtifactMetadata;
  return Boolean(meta && (meta.RequestFeedback || meta.UserFacing) && /plan/i.test(String(meta.Summary || "")));
}
function stepDetailText(step) {
  const type = shortType(step?.type ?? "");
  const args = toolArgs(step);
  let rawContent = typeof step?.content === "string" ? step.content.trim() : "";
  if (rawContent.length > 25e3) {
    rawContent = rawContent.slice(0, 1e4) + "\n\n...[TRUNCATED_BY_ANTIGRAVITY_REMOTE]...\n\n" + rawContent.slice(-1e4);
  }
  if (type === "RUN_COMMAND") {
    const cmd = args.CommandLine || "";
    let text = cmd ? `$ ${cmd}` : "";
    if (rawContent) {
      text += text ? `

${rawContent}` : rawContent;
    }
    return text || void 0;
  }
  if (type === "CODE_ACTION" || type === "REPLACE_FILE_CONTENT" || type === "MULTI_REPLACE_FILE_CONTENT") {
    const desc2 = args.Description || args.Instruction || "";
    let target = args.TargetContent || "";
    let replacement = args.ReplacementContent || "";
    if (target.length > 5e3)
      target = target.slice(0, 5e3) + "\n...[TRUNCATED]";
    if (replacement.length > 5e3)
      replacement = replacement.slice(0, 5e3) + "\n...[TRUNCATED]";
    let text = desc2 ? `Description: ${desc2}` : "";
    if (target || replacement) {
      if (text)
        text += "\n\n";
      if (target)
        text += `--- Target:
${target}
`;
      if (replacement)
        text += `+++ Replacement:
${replacement}`;
    }
    if (rawContent) {
      text += text ? `

${rawContent}` : rawContent;
    }
    return text || void 0;
  }
  if (type === "GREP_SEARCH") {
    const q = args.Query || "";
    const path7 = args.SearchPath || "";
    let text = `Query: "${q}"
Path: ${path7}`;
    if (rawContent)
      text += `

${rawContent}`;
    return text;
  }
  if (type === "VIEW_FILE") {
    const file = args.AbsolutePath || args.Path || "";
    const start = args.StartLine;
    const end = args.EndLine;
    let text = `File: ${file}` + (start != null ? ` (lines ${start}-${end})` : "");
    if (rawContent)
      text += `

${rawContent}`;
    return text;
  }
  if (rawContent)
    return rawContent;
  const desc = args.Description || args.Instruction || args.toolSummary || args.toolAction;
  if (desc)
    return String(desc);
  if (Object.keys(args).length > 0) {
    return JSON.stringify(args, null, 2);
  }
  return void 0;
}
function stepTokenCount(step) {
  const m = step?.metadata;
  const pr = step?.plannerResponse;
  const u = pr?.usageMetadata || pr?.tokenUsage || pr?.usage || m?.tokenUsage || m?.usage || {};
  const total = u.totalTokenCount || u.totalTokens || u.total_tokens || m?.totalTokens || m?.tokenCount;
  if (typeof total === "number" && total > 0)
    return total;
  const prompt = u.promptTokenCount || u.promptTokens || u.prompt_tokens || 0;
  const candidate = u.candidatesTokenCount || u.completionTokens || u.completion_tokens || 0;
  const sum = prompt + candidate;
  if (sum > 0)
    return sum;
  const detail = stepDetailText(step) || "";
  const raw = String(step?.content || pr?.response || "").trim();
  const textToMeasure = detail.length > raw.length ? detail : raw;
  if (textToMeasure.length > 0) {
    return Math.max(12, Math.round(textToMeasure.length / 3.4));
  }
  const typeLen = String(step?.type || "").length;
  return 18 + typeLen * 9 % 27;
}
function stepsToMessages(steps, cascadeId) {
  const msgs = [];
  const answeredArtifacts = /* @__PURE__ */ new Set();
  for (const step of steps) {
    const comments = step?.userInput?.artifactComments ?? step?.artifactComments ?? null;
    if (Array.isArray(comments)) {
      for (const c of comments) {
        const uri = String(c?.artifactUri ?? "");
        if (uri && c?.approvalStatus)
          answeredArtifacts.add(uri);
      }
    }
  }
  let turnTokens = 0;
  let turnDurationMs = 0;
  for (const step of steps) {
    const type = shortType(step.type);
    const durationMs = stepDurationMs(step);
    const stepTok = stepTokenCount(step);
    const stepOut = stepDetailText(step);
    if (durationMs != null && durationMs > 0)
      turnDurationMs += durationMs;
    if (stepTok != null && stepTok > 0)
      turnTokens += stepTok;
    if (type === "USER_INPUT") {
      turnTokens = 0;
      turnDurationMs = 0;
      const t = String(
        step.userInput?.userResponse ?? step.userInput?.items?.find((i) => i?.text)?.text ?? step.userInput?.items?.[0]?.text ?? ""
      ).trim();
      const stepIndex = step.metadata?.sourceTrajectoryStepInfo?.stepIndex;
      if (t)
        msgs.push({
          role: "user",
          text: t,
          stepIndex: typeof stepIndex === "number" ? stepIndex : void 0
        });
      continue;
    }
    if (type === "PLANNER_RESPONSE") {
      const resp = String(step.plannerResponse?.response ?? "").trim();
      if (resp) {
        msgs.push({
          role: "assistant",
          text: resp,
          meta: {
            type,
            tokens: stepTok ?? void 0,
            turnTokens: turnTokens > 0 ? turnTokens : void 0,
            turnDurationMs: turnDurationMs > 0 ? turnDurationMs : void 0
          }
        });
      }
      const calls = step.plannerResponse?.toolCalls;
      if (Array.isArray(calls)) {
        for (const tc of calls) {
          const toolName = String(tc?.name || "").toLowerCase();
          if (toolName === "ask_permission" || toolName === "ask_question") {
            try {
              const args = typeof tc?.argumentsJson === "string" ? JSON.parse(tc.argumentsJson) : tc?.args || {};
              const targetPath = args.Target || args.path || args.target || args.AbsolutePath || "";
              const actionType = args.Action || args.action || "read access";
              const questions = [{
                question: args.question || args.Reason || `Allow ${actionType} to this path?`,
                description: targetPath,
                options: Array.isArray(args.options) ? args.options.map((o, idx) => typeof o === "string" ? { id: String(idx + 1), text: o } : o) : [
                  { id: "1", text: "Yes, allow this time" },
                  { id: "2", text: "Yes, and always allow" },
                  { id: "3", text: "No (tell the agent what to do instead)" }
                ]
              }];
              const stepIndex = step.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? step.stepIndex ?? step.step_index;
              msgs.push({
                role: "ask",
                text: questions.map((q) => String(q?.question ?? "")).join("\n"),
                stepIndex: typeof stepIndex === "number" ? stepIndex : void 0,
                meta: {
                  type: "ASK_PERMISSION",
                  questions,
                  answered: false,
                  selected: []
                }
              });
              continue;
            } catch {
            }
          }
          const fakeStep = {
            type: `CORTEX_STEP_TYPE_${String(tc?.name || "").toUpperCase()}`,
            plannerResponse: { toolCalls: [tc] }
          };
          const info2 = toolInfo(fakeStep);
          const callOut = stepDetailText(fakeStep) || JSON.stringify(tc?.argumentsJson ? JSON.parse(tc.argumentsJson) : {}, null, 2);
          msgs.push({
            role: "tool",
            text: `${info2.verb}${info2.detail ? " " + info2.detail : ""}`,
            kind: info2.kind,
            detail: info2.detail,
            meta: {
              type,
              output: callOut,
              ...stepTok != null ? { tokens: stepTok } : {}
            }
          });
        }
      }
      continue;
    }
    if (type === "SYSTEM_MESSAGE" || type === "ERROR_MESSAGE") {
      const t = String(
        step.systemMessage?.message ?? step.systemMessage?.renderInfo?.title ?? ""
      ).trim();
      if (t)
        msgs.push({ role: "system", text: t, kind: type === "ERROR_MESSAGE" ? "error" : "system", meta: { type } });
      continue;
    }
    const isAskStep = type === "ASK_QUESTION" || type === "ASK_PERMISSION" || type === "REQUESTED_INTERACTION" || type === "PERMISSION_REQUEST" || type === "TOOL_PERMISSION_REQUEST" || Boolean(step.askQuestion) || Boolean(step.askPermission) || Boolean(step.requestedInteraction) || Boolean(step.permissionRequest) || Boolean(step.requestedPermission) || Boolean(step.toolPermissionRequest);
    if (isAskStep) {
      const lastMsg = msgs[msgs.length - 1];
      const ri = step.requestedInteraction || step.permissionRequest || step.requestedPermission || step.toolPermissionRequest || {};
      const aq = step.askQuestion || ri.askQuestion || step.askPermission || ri.askPermission || step.permissionRequest || step.requestedPermission || step.toolPermissionRequest || ri.toolPermissionRequest || ri.permissionRequest || ri;
      let targetPath = "";
      const scanObj = (o, depth = 0) => {
        if (!o || typeof o !== "object" || depth > 5)
          return;
        if (!targetPath) {
          const found = o.targetPath || o.target || o.path || o.resource || o.file || o.filePath || o.Target || o.TargetFile || o.Path || o.Resource || o.uri || "";
          if (found && typeof found === "string" && found.length > 1) {
            targetPath = found;
            return;
          }
        }
        for (const k of Object.keys(o)) {
          if (o[k] && typeof o[k] === "object" && k !== "options" && k !== "questions" && k !== "plannerResponse") {
            scanObj(o[k], depth + 1);
            if (targetPath)
              return;
          }
        }
      };
      scanObj(step);
      let actionType = ri.permissionType || ri.action || aq.action || aq.permissionType || "read access";
      let reasonText = aq.reason || aq.question || aq.title || ri.reason || "";
      if (!targetPath && (!reasonText || reasonText.toLowerCase().includes("allow read access")) && lastMsg && lastMsg.role === "ask") {
        continue;
      }
      if (!reasonText) {
        reasonText = targetPath ? `C\u1EA5p quy\u1EC1n truy c\u1EADp cho t\u1EC7p tin / th\u01B0 m\u1EE5c:` : `Allow ${actionType} to this path?`;
      }
      let questions = [];
      if (Array.isArray(aq?.questions) && aq.questions.length > 0) {
        questions = aq.questions.map((q) => ({
          ...q,
          description: q.description || q.targetPath || q.target || q.path || targetPath
        }));
      } else {
        questions = [{
          question: reasonText,
          description: targetPath,
          options: [
            { id: "1", text: "Yes, allow this time" },
            { id: "2", text: "Yes, and always allow" },
            { id: "3", text: "No (tell the agent what to do instead)" }
          ]
        }];
      }
      if (questions.length === 0 && step.plannerResponse?.toolCalls) {
        for (const tc of step.plannerResponse.toolCalls) {
          if (tc.name === "ask_permission" || tc.name === "ask_question") {
            try {
              const args = tc.argumentsJson ? JSON.parse(tc.argumentsJson) : tc.args || {};
              const targetPath2 = args.Target || args.path || args.target || "";
              const actionType2 = args.Action || args.action || "read access";
              questions = [{
                question: args.question || args.Reason || `Allow ${actionType2} to this path?`,
                description: targetPath2,
                options: Array.isArray(args.options) ? args.options.map((o, idx) => typeof o === "string" ? { id: String(idx + 1), text: o } : o) : [
                  { id: "1", text: "Yes, allow this time" },
                  { id: "2", text: "Yes, and always allow" },
                  { id: "3", text: "No (tell the agent what to do instead)" }
                ]
              }];
            } catch {
            }
          }
        }
      }
      if (questions.length > 0) {
        const answered = Array.isArray(step.completedInteractions) && step.completedInteractions.length > 0 ? true : questions.some(
          (q) => q?.skipped === true || Array.isArray(q?.selectedOptionIds) && q.selectedOptionIds.length > 0
        );
        const stepIndex = step.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? step.stepIndex ?? step.step_index;
        const selected = [];
        for (const q of questions) {
          if (Array.isArray(q?.selectedOptionIds))
            selected.push(...q.selectedOptionIds);
        }
        msgs.push({
          role: "ask",
          text: questions.map((q) => String(q?.question ?? "")).join("\n"),
          stepIndex: typeof stepIndex === "number" ? stepIndex : void 0,
          meta: {
            type,
            questions,
            answered,
            selected
          }
        });
        continue;
      }
    }
    if (type === "CHECKPOINT" || type === "EPHEMERAL_MESSAGE" || type === "CONVERSATION_HISTORY" || type === "KNOWLEDGE_ARTIFACTS" || type === "USER_INPUT") {
      continue;
    }
    if (type === "CODE_ACTION" && isPlanStep(step)) {
      const args = toolArgs(step);
      const spec = step?.codeAction?.actionSpec?.createFile;
      const body = String(
        spec?.instruction || args.CodeContent || args?.ArtifactMetadata?.Summary || ""
      ).trim();
      const artifactUri = String(spec?.path?.absoluteUri ?? "");
      const answered = artifactUri && answeredArtifacts.has(artifactUri) || Array.isArray(step?.completedInteractions) && step.completedInteractions.length > 0;
      if (body) {
        msgs.push({
          role: "plan",
          text: body,
          meta: { type, artifactUri, answered }
        });
        continue;
      }
    }
    if (type === "CODE_ACTION" && step?.codeAction?.isArtifactFile) {
      const spec = step?.codeAction?.actionSpec?.createFile;
      const uri = String(spec?.path?.absoluteUri ?? "");
      if (uri) {
        const name = baseName(uri);
        msgs.push({
          role: "artifact",
          text: name,
          meta: { type, artifactUri: uri }
        });
        continue;
      }
    }
    const info = toolInfo(step);
    if (info.verb) {
      const diff = diffStats(step);
      const editUri = type === "CODE_ACTION" ? String(
        step?.codeAction?.actionResult?.edit?.absoluteUri || step?.codeAction?.actionSpec?.createFile?.path?.absoluteUri || ""
      ) : "";
      msgs.push({
        role: "tool",
        text: `${info.verb}${info.detail ? " " + info.detail : ""}`,
        kind: info.kind,
        detail: stepOut || info.detail,
        meta: {
          type,
          ...durationMs != null ? { durationMs } : {},
          ...stepTok != null ? { tokens: stepTok } : {},
          ...stepOut ? { output: stepOut } : {},
          ...diff ? { added: diff.added, removed: diff.removed } : {},
          ...editUri ? { artifactUri: editUri } : {}
        }
      });
    }
  }
  return msgs;
}
function titleCase(s) {
  return s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function numOr(v, fallback = 0) {
  const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function getStatsFilePath() {
  const dir = path.join(os.homedir(), ".antigravity_cockpit");
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
    }
  }
  return path.join(dir, "today_stats.json");
}
function getTodayDateStr() {
  const d = /* @__PURE__ */ new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function loadTodayStats() {
  const filePath = getStatsFilePath();
  const todayStr = getTodayDateStr();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.date === todayStr) {
        return {
          date: todayStr,
          totalChats: Number(parsed.totalChats) || 0,
          totalTokens: Number(parsed.totalTokens) || 0,
          totalDurationMs: Number(parsed.totalDurationMs) || 0
        };
      }
    }
  } catch {
  }
  return { date: todayStr, totalChats: 0, totalTokens: 0, totalDurationMs: 0 };
}
function saveTodayStats(stats) {
  const filePath = getStatsFilePath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(stats, null, 2), "utf-8");
  } catch {
  }
}
function recordChatTurnDelta(chatsDelta, tokensDelta, durationDelta) {
  const stats = loadTodayStats();
  if (chatsDelta > 0)
    stats.totalChats += chatsDelta;
  if (tokensDelta > 0)
    stats.totalTokens += tokensDelta;
  if (durationDelta > 0)
    stats.totalDurationMs += durationDelta;
  saveTodayStats(stats);
  return stats;
}
function resetTodayStatsFile() {
  const stats = { date: getTodayDateStr(), totalChats: 0, totalTokens: 0, totalDurationMs: 0 };
  saveTodayStats(stats);
  return stats;
}
var trackedCascadeStats = /* @__PURE__ */ new Map();
function accumulateStatsFromSteps(cascadeId, steps, onStatsUpdate) {
  if (!cascadeId)
    return;
  let cascadeData = trackedCascadeStats.get(cascadeId);
  const isFirstLoad = !cascadeData;
  if (!cascadeData) {
    cascadeData = { stepStats: /* @__PURE__ */ new Map(), userChats: /* @__PURE__ */ new Set() };
    trackedCascadeStats.set(cascadeId, cascadeData);
  }
  let deltaTokens = 0;
  let deltaDuration = 0;
  let deltaChats = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const idx = i;
    const isUser = shortType(step.type) === "USER_INPUT";
    if (isUser) {
      if (!cascadeData.userChats.has(idx)) {
        cascadeData.userChats.add(idx);
        if (!isFirstLoad)
          deltaChats += 1;
      }
    }
    const t = stepTokenCount(step) || 0;
    const d = isUser ? 0 : stepDurationMs(step) || 0;
    if (t > 0 || d > 0) {
      const prevStepStat = cascadeData.stepStats.get(idx) || { tokens: 0, duration: 0 };
      const dt = t - prevStepStat.tokens;
      const dd = d - prevStepStat.duration;
      if (!isFirstLoad) {
        if (dt > 0)
          deltaTokens += dt;
        if (dd > 0)
          deltaDuration += dd;
      }
      cascadeData.stepStats.set(idx, { tokens: t, duration: d });
    }
  }
  if (deltaChats > 0 || deltaTokens > 0 || deltaDuration > 0) {
    const newStats = recordChatTurnDelta(deltaChats, deltaTokens, deltaDuration);
    if (onStatsUpdate)
      onStatsUpdate(newStats);
  }
}

// src/server.ts
var http3 = __toESM(require("http"));
var crypto = __toESM(require("crypto"));
var fs5 = __toESM(require("fs"));
var path4 = __toESM(require("path"));
var import_url = require("url");

// src/fileController.ts
var vscode2 = __toESM(require("vscode"));
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
function workspaceRoot() {
  const folders = vscode2.workspace.workspaceFolders;
  if (!folders || folders.length === 0)
    return null;
  return folders[0].uri.fsPath;
}
function resolveSafe(rel) {
  const root = workspaceRoot();
  if (!root)
    return null;
  const abs = path2.isAbsolute(rel) ? path2.resolve(rel) : path2.resolve(root, rel.replace(/^[/\\]+/, ""));
  if (abs !== root && !abs.startsWith(root + path2.sep))
    return null;
  return abs;
}
var FileController = {
  hasWorkspace() {
    return workspaceRoot() !== null;
  },
  root() {
    return workspaceRoot();
  },
  list(rel = "") {
    const abs = resolveSafe(rel);
    const root = workspaceRoot();
    if (!abs || !root)
      return [];
    if (!fs2.existsSync(abs))
      return [];
    const stat = fs2.statSync(abs);
    if (!stat.isDirectory())
      return [];
    const items = fs2.readdirSync(abs, { withFileTypes: true });
    const out = [];
    for (const it of items) {
      if (it.name === ".git" || it.name === "node_modules")
        continue;
      const childAbs = path2.join(abs, it.name);
      const relPath = path2.relative(root, childAbs).split(path2.sep).join("/");
      if (it.isDirectory()) {
        out.push({ name: it.name, path: relPath, type: "dir" });
      } else {
        let size = 0;
        try {
          size = fs2.statSync(childAbs).size;
        } catch {
        }
        out.push({ name: it.name, path: relPath, type: "file", size });
      }
    }
    out.sort(
      (a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1
    );
    return out;
  },
  read(rel) {
    const abs = resolveSafe(rel);
    if (!abs)
      return { error: "invalid path" };
    if (!fs2.existsSync(abs))
      return { error: "not found" };
    const stat = fs2.statSync(abs);
    if (stat.isDirectory())
      return { error: "is a directory" };
    if (stat.size > 2 * 1024 * 1024)
      return { error: "file too large (>2MB)" };
    try {
      return { text: fs2.readFileSync(abs, "utf8") };
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  },
  readBinary(rel) {
    const abs = resolveSafe(rel);
    if (!abs || !fs2.existsSync(abs))
      return null;
    try {
      return fs2.readFileSync(abs);
    } catch {
      return null;
    }
  },
  write(rel, text) {
    const abs = resolveSafe(rel);
    if (!abs)
      return { error: "invalid path" };
    try {
      fs2.mkdirSync(path2.dirname(abs), { recursive: true });
      fs2.writeFileSync(abs, text, "utf8");
      return { ok: true };
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  },
  // Save an uploaded file/image (buffer) into the workspace, default under
  // an `uploads/` folder. Returns the workspace-relative path.
  saveUpload(filename, data, subdir = "uploads") {
    const root = workspaceRoot();
    if (!root)
      return { error: "no workspace open" };
    const safeName = path2.basename(filename).replace(/[^\w.\-]+/g, "_");
    const relPath = path2.posix.join(subdir, `${Date.now()}_${safeName}`);
    const abs = resolveSafe(relPath);
    if (!abs)
      return { error: "invalid path" };
    try {
      fs2.mkdirSync(path2.dirname(abs), { recursive: true });
      fs2.writeFileSync(abs, data);
      return { path: relPath, abs };
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  },
  delete(rel) {
    const abs = resolveSafe(rel);
    if (!abs)
      return { error: "invalid path" };
    if (!fs2.existsSync(abs))
      return { error: "not found" };
    try {
      const stat = fs2.statSync(abs);
      if (stat.isDirectory())
        fs2.rmSync(abs, { recursive: true, force: true });
      else
        fs2.unlinkSync(abs);
      return { ok: true };
    } catch (e) {
      return { error: String(e?.message ?? e) };
    }
  },
  async openInEditor(rel) {
    const abs = resolveSafe(rel);
    if (!abs || !fs2.existsSync(abs))
      return false;
    try {
      const doc = await vscode2.workspace.openTextDocument(abs);
      await vscode2.window.showTextDocument(doc);
      return true;
    } catch {
      return false;
    }
  }
};

// src/gitController.ts
var vscode3 = __toESM(require("vscode"));
var import_child_process2 = require("child_process");
var import_util2 = require("util");
var execAsync2 = (0, import_util2.promisify)(import_child_process2.exec);
function cwd() {
  const folders = vscode3.workspace.workspaceFolders;
  if (!folders || folders.length === 0)
    return null;
  return folders[0].uri.fsPath;
}
async function run(cmd, timeout = 2e4) {
  const dir = cwd();
  if (!dir)
    return { stdout: "", stderr: "no workspace open", ok: false };
  try {
    const { stdout, stderr } = await execAsync2(cmd, {
      cwd: dir,
      timeout,
      maxBuffer: 8 * 1024 * 1024
    });
    return { stdout: String(stdout), stderr: String(stderr), ok: true };
  } catch (e) {
    return {
      stdout: String(e?.stdout ?? ""),
      stderr: String(e?.stderr ?? e?.message ?? e),
      ok: false
    };
  }
}
var GitController = {
  async isRepo() {
    const r = await run("git rev-parse --is-inside-work-tree");
    return r.ok && r.stdout.trim() === "true";
  },
  async status() {
    const r = await run("git status --porcelain=v1 --branch");
    const files = [];
    let branch = "";
    let ahead = 0;
    let behind = 0;
    for (const line of r.stdout.split("\n")) {
      if (!line)
        continue;
      if (line.startsWith("##")) {
        const m = line.match(/##\s+([^\s.]+)/);
        if (m)
          branch = m[1];
        const a = line.match(/ahead (\d+)/);
        const b = line.match(/behind (\d+)/);
        if (a)
          ahead = parseInt(a[1], 10);
        if (b)
          behind = parseInt(b[1], 10);
        continue;
      }
      const index = line[0];
      const work = line[1];
      const path7 = line.slice(3);
      files.push({ path: path7, index, work });
    }
    return { branch, files, ahead, behind };
  },
  async diff(file) {
    const cmd = file ? `git diff -- ${JSON.stringify(file)}` : "git diff";
    const r = await run(cmd);
    return r.stdout || r.stderr;
  },
  async log(limit = 20) {
    const sep2 = "";
    const r = await run(
      `git log -n ${limit} --pretty=format:%h${sep2}%an${sep2}%ad${sep2}%s --date=short`
    );
    const out = [];
    for (const line of r.stdout.split("\n")) {
      if (!line)
        continue;
      const [hash, author, date, subject] = line.split(sep2);
      out.push({ hash, author, date, subject });
    }
    return out;
  },
  async stageAll() {
    const r = await run("git add -A");
    return { ok: r.ok, message: r.stderr || "staged all changes" };
  },
  async stage(file) {
    const r = await run(`git add -- ${JSON.stringify(file)}`);
    return { ok: r.ok, message: r.stderr || `staged ${file}` };
  },
  // Flexible stage: accepts "." / "-A" for everything, a single path string,
  // or an array of paths. Used by the REST API's git/add route.
  async add(files) {
    if (files === "." || files === "-A" || files === "*") {
      return this.stageAll();
    }
    const list = Array.isArray(files) ? files : [files];
    const safe = list.filter(Boolean).map((f) => JSON.stringify(f)).join(" ");
    if (!safe)
      return this.stageAll();
    const r = await run(`git add -- ${safe}`);
    return { ok: r.ok, message: r.stderr || `staged ${list.join(", ")}` };
  },
  async commit(message) {
    const escaped = message.replace(/"/g, '\\"');
    const r = await run(`git commit -m "${escaped}"`);
    return { ok: r.ok, message: r.stdout || r.stderr };
  },
  async push(branch, setUpstream = false) {
    let cmd = "git push";
    const target = branch || (setUpstream ? (await this.status()).branch : "");
    if (setUpstream && target) {
      cmd = `git push -u origin ${JSON.stringify(target)}`;
    } else if (target) {
      cmd = `git push origin ${JSON.stringify(target)}`;
    }
    const r = await run(cmd, 6e4);
    return { ok: r.ok, message: r.stdout || r.stderr };
  },
  async pull() {
    const r = await run("git pull", 6e4);
    return { ok: r.ok, message: r.stdout || r.stderr };
  },
  async createBranch(name) {
    const safe = name.replace(/[^\w./\-]+/g, "-");
    const r = await run(`git checkout -b ${JSON.stringify(safe)}`);
    return { ok: r.ok, message: r.stdout || r.stderr };
  },
  async checkout(ref) {
    const r = await run(`git checkout ${JSON.stringify(ref)}`);
    return { ok: r.ok, message: r.stdout || r.stderr };
  },
  async branches() {
    const r = await run("git branch --format=%(refname:short)");
    const cur = await run("git rev-parse --abbrev-ref HEAD");
    return {
      current: cur.stdout.trim(),
      all: r.stdout.split("\n").map((s) => s.trim()).filter(Boolean)
    };
  },
  // --- GitHub via gh CLI (optional) ---
  async ghAvailable() {
    const r = await run("gh --version", 5e3);
    return r.ok;
  },
  async createPR(title, body) {
    if (!await this.ghAvailable())
      return { ok: false, message: "gh CLI not installed" };
    const t = title.replace(/"/g, '\\"');
    const b = body.replace(/"/g, '\\"');
    const r = await run(
      `gh pr create --title "${t}" --body "${b}"`,
      6e4
    );
    return { ok: r.ok, message: r.stdout || r.stderr };
  },
  async listPRs() {
    if (!await this.ghAvailable())
      return { ok: false, message: "gh CLI not installed" };
    const r = await run(
      "gh pr list --limit 20 --json number,title,author,state 2>/dev/null || gh pr list"
    );
    return { ok: r.ok, message: r.stdout || r.stderr };
  }
};

// src/settingsController.ts
var vscode4 = __toESM(require("vscode"));
var fs3 = __toESM(require("fs"));
var os2 = __toESM(require("os"));
var path3 = __toESM(require("path"));
var CFG = "antigravityRemotePlus";
var EDITABLE_KEYS = [
  "port",
  "bindHost",
  "password",
  "autoStart",
  "remoteDebugPort",
  "telegramEnabled",
  "telegramToken",
  "telegramChatId",
  "workspaceRoot"
];
function cockpitDir() {
  return path3.join(os2.homedir(), ".antigravity_cockpit");
}
function readJsonSafe(file) {
  try {
    if (!fs3.existsSync(file))
      return null;
    return JSON.parse(fs3.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}
var SettingsController = {
  // ---- Account ----
  // Reads the Cockpit account vault: accounts.json (the roster) plus each
  // per-account file under accounts/<id>.json (which carries the live quota).
  // No secrets (tokens) are ever returned to the browser.
  account() {
    const dir = cockpitDir();
    const current = readJsonSafe(path3.join(dir, "current_account.json"));
    const currentEmail = current?.email ?? null;
    const roster = readJsonSafe(path3.join(dir, "accounts.json"));
    const list = Array.isArray(roster?.accounts) ? roster.accounts : [];
    const accounts = list.map((a) => {
      const detail = a?.id ? readJsonSafe(path3.join(dir, "accounts", `${a.id}.json`)) : null;
      const models = Array.isArray(detail?.quota?.models) ? detail.quota.models : [];
      const seen = /* @__PURE__ */ new Set();
      const quota = [];
      for (const m of models) {
        const rawName = String(m?.name ?? "");
        const dn = String(m?.display_name || rawName || "Model");
        if (!dn || seen.has(dn))
          continue;
        seen.add(dn);
        quota.push({
          name: rawName,
          displayName: dn,
          percentage: numOr2(m?.percentage),
          resetTime: m?.reset_time ? String(m.reset_time) : void 0
        });
      }
      return {
        id: String(a?.id ?? ""),
        email: String(a?.email ?? ""),
        name: String(a?.name ?? a?.email ?? ""),
        current: currentEmail != null && a?.email === currentEmail,
        disabled: Boolean(detail?.disabled),
        tier: detail?.quota?.subscription_tier ? String(detail.quota.subscription_tier) : void 0,
        lastUsed: numOr2(a?.last_used) || void 0,
        quota
      };
    });
    return { currentEmail, accounts };
  },
  // Switch the active Cockpit account by updating current_account.json,
  // instances.json, accounts.json, and notifying the active Cockpit Tools WebSocket server.
  async switchAccount(email) {
    if (!email)
      return { ok: false, error: "Ch\u01B0a ch\u1ECDn email t\xE0i kho\u1EA3n" };
    const dir = cockpitDir();
    const roster = readJsonSafe(path3.join(dir, "accounts.json"));
    const list = Array.isArray(roster?.accounts) ? roster.accounts : [];
    const match = list.find((a) => a?.email === email);
    if (!match)
      return { ok: false, error: "T\xE0i kho\u1EA3n kh\xF4ng t\u1ED3n t\u1EA1i trong Cockpit" };
    try {
      const now = Math.floor(Date.now() / 1e3);
      fs3.writeFileSync(
        path3.join(dir, "current_account.json"),
        JSON.stringify({ email, updated_at: now }, null, 2)
      );
      try {
        const instancesFile = path3.join(dir, "instances.json");
        const instData = readJsonSafe(instancesFile) || { instances: [], defaultSettings: {} };
        if (!instData.defaultSettings)
          instData.defaultSettings = {};
        instData.defaultSettings.bindAccountId = match.id;
        fs3.writeFileSync(instancesFile, JSON.stringify(instData, null, 2));
      } catch {
      }
      try {
        const codexFile = path3.join(dir, "codex_accounts.json");
        const codexData = readJsonSafe(codexFile);
        if (codexData && Array.isArray(codexData.accounts)) {
          const codexMatch = codexData.accounts.find((ca) => ca.email === email);
          if (codexMatch) {
            codexData.current_account_id = codexMatch.id;
            fs3.writeFileSync(codexFile, JSON.stringify(codexData, null, 2));
          }
        }
      } catch {
      }
      if (match) {
        match.last_used = now;
        roster.accounts = [match, ...list.filter((a) => a?.email !== email)];
        try {
          fs3.writeFileSync(path3.join(dir, "accounts.json"), JSON.stringify(roster, null, 2));
        } catch {
        }
      }
      try {
        const serverFile = path3.join(dir, "server.json");
        const serverInfo = readJsonSafe(serverFile);
        if (serverInfo?.ws_port && serverInfo?.auth_token) {
          const ws = new wrapper_default(`ws://127.0.0.1:${serverInfo.ws_port}`, {
            headers: { Authorization: `Bearer ${serverInfo.auth_token}` }
          });
          ws.on("open", () => {
            const payload = { account_id: match.id, email: match.email, id: match.id };
            ws.send(JSON.stringify({ type: "tools.ws.request_switch_account", data: payload }));
            ws.send(JSON.stringify({ type: "tools.ws.request_switch_account", payload }));
            ws.send(JSON.stringify({ type: "tools.ws.request_switch_account", account_id: match.id, email: match.email }));
            ws.send(JSON.stringify({ action: "tools.ws.request_switch_account", account_id: match.id, email: match.email }));
            ws.send(JSON.stringify({ command: "tools.ws.request_switch_account", account_id: match.id, email: match.email }));
            ws.send(JSON.stringify({ type: "ws_request_switch_account", payload }));
            ws.send(JSON.stringify({ type: "ws_request_switch_account", account_id: match.id, email: match.email }));
            ws.send(JSON.stringify({ type: "ws_switch_account", payload }));
            ws.send(JSON.stringify({ type: "ws_switch_account", account_id: match.id, email: match.email }));
            ws.send(JSON.stringify({ type: "tools.account.switch", payload }));
            ws.send(JSON.stringify({ type: "switch_account", email, account_id: match.id }));
            setTimeout(() => {
              try {
                ws.close();
              } catch {
              }
            }, 600);
          });
          ws.on("error", () => {
          });
        }
      } catch {
      }
      try {
        const { exec: exec3 } = require("child_process");
        exec3(`open "cockpit-tools://switch?account_id=${match.id}&email=${encodeURIComponent(email)}"`);
        exec3(`open "cockpit-tools://switch-account?id=${match.id}&email=${encodeURIComponent(email)}"`);
        exec3(`osascript -e 'tell application "Cockpit Tools" to activate'`);
      } catch {
      }
      try {
        const { execSync } = require("child_process");
        const dbPath = path3.join(os2.homedir(), "Library/Application Support/Antigravity IDE/User/globalStorage/state.vscdb");
        if (fs3.existsSync(dbPath)) {
          execSync(`sqlite3 "${dbPath}" "DELETE FROM ItemTable WHERE key IN ('antigravityUnifiedStateSync.oauthToken', 'antigravityUnifiedStateSync.userStatus');"`);
        }
      } catch {
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  },
  // ---- Settings ----
  get() {
    const c = vscode4.workspace.getConfiguration(CFG);
    return {
      port: c.get("port", 7377),
      bindHost: c.get("bindHost", "0.0.0.0"),
      password: c.get("password", ""),
      autoStart: c.get("autoStart", true),
      remoteDebugPort: c.get("remoteDebugPort", 9222),
      telegramEnabled: c.get("telegramEnabled", false),
      telegramToken: c.get("telegramToken", ""),
      telegramChatId: c.get("telegramChatId", ""),
      workspaceRoot: c.get("workspaceRoot", "")
    };
  },
  // List workspace folders under the configured root. The user only sets one
  // path; we auto-detect whether it is:
  //   * a container of projects  → list each sub-folder as a workspace, OR
  //   * a single project itself (has .git / looks like a project) → the root IS
  //     the workspace, returned as the sole entry.
  workspaceFolders() {
    const c = vscode4.workspace.getConfiguration(CFG);
    const root = c.get("workspaceRoot", "");
    const current = this.currentWorkspace();
    if (!root || !root.trim())
      return { root: "", current, folders: [] };
    try {
      const abs = path3.resolve(root);
      if (!fs3.existsSync(abs) || !fs3.statSync(abs).isDirectory()) {
        return { root: abs, current, folders: [] };
      }
      const entries = fs3.readdirSync(abs, { withFileTypes: true });
      const projectMarkers = [
        ".git",
        "package.json",
        "Cargo.toml",
        "go.mod",
        "pom.xml",
        "pyproject.toml",
        "Makefile"
      ];
      const isProject = entries.some((e) => projectMarkers.includes(e.name));
      if (isProject) {
        return {
          root: abs,
          current,
          folders: [{ name: path3.basename(abs), path: abs }]
        };
      }
      const folders = entries.filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => ({ name: d.name, path: path3.join(abs, d.name) })).sort((a, b) => a.name.localeCompare(b.name));
      if (folders.length === 0) {
        return {
          root: abs,
          current,
          folders: [{ name: path3.basename(abs), path: abs }]
        };
      }
      return { root: abs, current, folders };
    } catch {
      return { root, current, folders: [] };
    }
  },
  async update(patch) {
    const c = vscode4.workspace.getConfiguration(CFG);
    for (const key of EDITABLE_KEYS) {
      if (key in patch && patch[key] !== void 0) {
        await c.update(key, patch[key], vscode4.ConfigurationTarget.Global);
      }
    }
    return this.get();
  },
  // ---- Filesystem browse (for the workspace picker) ----
  // Lists directories under an absolute path. Defaults to the home dir.
  browse(dir) {
    const home = os2.homedir();
    let target = dir && dir.trim() ? dir : home;
    try {
      target = path3.resolve(target);
      if (!fs3.existsSync(target) || !fs3.statSync(target).isDirectory()) {
        target = home;
      }
    } catch {
      target = home;
    }
    let dirs = [];
    try {
      dirs = fs3.readdirSync(target, { withFileTypes: true }).filter((d) => {
        if (!d.isDirectory())
          return false;
        if (d.name.startsWith("."))
          return false;
        return true;
      }).map((d) => d.name).sort((a, b) => a.localeCompare(b));
    } catch {
      dirs = [];
    }
    const parent = path3.dirname(target);
    return {
      cwd: target,
      parent: parent === target ? null : parent,
      dirs,
      home
    };
  },
  currentWorkspace() {
    const folders = vscode4.workspace.workspaceFolders;
    return folders && folders.length ? folders[0].uri.fsPath : null;
  },
  // Open a folder as the workspace. VS Code reloads the window to do this.
  async openWorkspace(dir) {
    try {
      const abs = path3.resolve(dir);
      if (!fs3.existsSync(abs) || !fs3.statSync(abs).isDirectory()) {
        return { ok: false, error: "not a directory" };
      }
      await vscode4.commands.executeCommand(
        "vscode.openFolder",
        vscode4.Uri.file(abs),
        { forceNewWindow: false }
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  }
};
function numOr2(v, fallback = 0) {
  const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// src/terminalController.ts
var import_child_process3 = require("child_process");
var os3 = __toESM(require("os"));
var fs4 = __toESM(require("fs"));
var MAX_BUFFER = 2e5;
function defaultShell() {
  if (process.platform === "win32")
    return process.env.COMSPEC || "cmd.exe";
  return process.env.SHELL || "/bin/bash";
}
var counter = 0;
var TerminalController = class {
  constructor(log2, emit) {
    this.terms = /* @__PURE__ */ new Map();
    this.log = log2;
    this.emit = emit;
  }
  // Resolve a usable cwd: the requested dir if it exists, else home.
  resolveCwd(cwd2) {
    if (cwd2 && cwd2.trim()) {
      try {
        if (fs4.existsSync(cwd2) && fs4.statSync(cwd2).isDirectory())
          return cwd2;
      } catch {
      }
    }
    return os3.homedir();
  }
  create(cwd2, title) {
    const id = `t${Date.now()}_${++counter}`;
    const dir = this.resolveCwd(cwd2);
    const shell = defaultShell();
    const proc = (0, import_child_process3.spawn)(shell, process.platform === "win32" ? [] : ["-i"], {
      cwd: dir,
      env: { ...process.env, TERM: "xterm-256color" },
      shell: false
    });
    const term = {
      id,
      title: title || dirName(dir),
      cwd: dir,
      proc,
      buffer: "",
      alive: true
    };
    this.terms.set(id, term);
    const onData = (chunk) => {
      const s = stripAnsi(chunk.toString("utf8"));
      term.buffer += s;
      if (term.buffer.length > MAX_BUFFER) {
        term.buffer = term.buffer.slice(term.buffer.length - MAX_BUFFER);
      }
      this.emit({ type: "term-data", id, data: s });
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", (code) => {
      term.alive = false;
      this.emit({ type: "term-exit", id, code });
      this.emitList();
    });
    proc.on("error", (e) => {
      const msg = `\r
[shell error: ${e.message}]\r
`;
      term.buffer += msg;
      this.emit({ type: "term-data", id, data: msg });
    });
    this.log(`[term] created ${id} cwd=${dir} pid=${proc.pid}`);
    this.emitList();
    return this.info(term);
  }
  // Send raw input to a terminal. Callers typically append "\n" to run a line.
  write(id, data) {
    const term = this.terms.get(id);
    if (!term || !term.alive)
      return false;
    try {
      term.proc.stdin.write(data);
      return true;
    } catch (e) {
      this.log(`[term] write failed ${id}: ${e.message}`);
      return false;
    }
  }
  kill(id) {
    const term = this.terms.get(id);
    if (!term)
      return false;
    try {
      term.proc.kill();
    } catch {
    }
    this.terms.delete(id);
    this.log(`[term] killed ${id}`);
    this.emitList();
    return true;
  }
  // The accumulated output buffer for a terminal (for a fresh client).
  getBuffer(id) {
    return this.terms.get(id)?.buffer ?? "";
  }
  list() {
    return [...this.terms.values()].map((t) => this.info(t));
  }
  killAll() {
    for (const id of [...this.terms.keys()])
      this.kill(id);
  }
  info(t) {
    return { id: t.id, title: t.title, cwd: t.cwd, pid: t.proc.pid, alive: t.alive };
  }
  emitList() {
    this.emit({ type: "term-list", terminals: this.list() });
  }
};
function dirName(p) {
  const parts = p.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || p;
}
function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b[()][0-9A-Za-z]/g, "").replace(/\x1b[=>]/g, "").replace(/\x1b/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

// src/server.ts
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2"
};
var RemoteServer = class {
  constructor(opts, chat2) {
    this.server = null;
    this.sseClients = /* @__PURE__ */ new Set();
    this.unsub = null;
    this.boundPort = 0;
    this.opts = opts;
    this.chat = chat2;
    this.terminals = new TerminalController(opts.log, (e) => this.broadcast(e));
  }
  /** The port the server actually bound to (may differ from opts.port if it
   * was busy and we fell back to the next free port). */
  get activePort() {
    return this.boundPort || this.opts.port;
  }
  // Token is derived deterministically from the password so it stays valid
  // across server restarts / IDE reloads — otherwise a random per-boot secret
  // would log the user out on every reload.
  token() {
    return crypto.createHmac("sha256", "antigravity-remote-plus/v1").update(this.opts.password).digest("hex");
  }
  isAuthed(req) {
    if (!this.opts.password)
      return true;
    const auth = req.headers["authorization"];
    if (auth && auth === `Bearer ${this.token()}`)
      return true;
    const cookie = req.headers["cookie"] ?? "";
    const m = /(?:^|;\s*)arp_token=([^;]+)/.exec(cookie);
    if (m && m[1] === this.token())
      return true;
    return false;
  }
  start() {
    const port = this.opts.port;
    const maxAttempts = 10;
    const retryDelayMs = 400;
    const attempt = (n) => new Promise((resolve3, reject) => {
      const server2 = http3.createServer(
        (req, res) => this.handle(req, res).catch((e) => {
          this.opts.log(`[server] handler error: ${e?.message ?? e}`);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "internal error" }));
          }
        })
      );
      const onError = (err) => {
        server2.removeListener("error", onError);
        server2.close();
        if (err.code === "EADDRINUSE" && n < maxAttempts) {
          this.opts.log(
            `[server] port ${port} busy (attempt ${n}/${maxAttempts}), retrying in ${retryDelayMs}ms\u2026`
          );
          setTimeout(() => attempt(n + 1).then(resolve3, reject), retryDelayMs);
        } else if (err.code === "EADDRINUSE") {
          reject(
            new Error(
              `port ${port} is still in use after ${maxAttempts} attempts. Run "Antigravity Remote Plus: Stop" (or reload the window) to release it.`
            )
          );
        } else {
          reject(err);
        }
      };
      server2.on("error", onError);
      server2.listen(port, this.opts.host, () => {
        server2.removeListener("error", onError);
        this.server = server2;
        this.boundPort = port;
        server2.on(
          "error",
          (e) => this.opts.log(`[server] runtime error: ${e.message}`)
        );
        this.unsub = this.chat.onEvent((e) => this.broadcast(e));
        this.opts.log(`[server] listening on http://${this.opts.host}:${port}`);
        resolve3();
      });
    });
    return attempt(1);
  }
  stop() {
    this.unsub?.();
    for (const c of this.sseClients) {
      try {
        c.end();
      } catch {
      }
    }
    this.sseClients.clear();
    this.server?.close();
    this.server = null;
  }
  broadcast(e) {
    const data = `data: ${JSON.stringify(e)}

`;
    for (const c of this.sseClients) {
      try {
        c.write(data);
      } catch {
      }
    }
  }
  json(res, code, body) {
    const s = JSON.stringify(body);
    res.writeHead(code, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(s)
    });
    res.end(s);
  }
  async readBody(req) {
    const chunks = [];
    let total = 0;
    return new Promise((resolve3, reject) => {
      req.on("data", (c) => {
        total += c.length;
        if (total > 25 * 1024 * 1024) {
          reject(new Error("payload too large"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve3(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }
  async readJson(req) {
    const buf = await this.readBody(req);
    if (buf.length === 0)
      return {};
    try {
      return JSON.parse(buf.toString("utf8"));
    } catch {
      return {};
    }
  }
  // Minimal multipart/form-data parser (single/multiple file fields).
  parseMultipart(buf, contentType) {
    const fields = {};
    const files = [];
    const bm = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
    if (!bm)
      return { fields, files };
    const boundary = "--" + (bm[1] ?? bm[2]).trim();
    const sep2 = Buffer.from(boundary);
    let start = buf.indexOf(sep2);
    if (start === -1)
      return { fields, files };
    start += sep2.length;
    while (start < buf.length) {
      if (buf[start] === 45 && buf[start + 1] === 45)
        break;
      if (buf[start] === 13 && buf[start + 1] === 10)
        start += 2;
      const headerEnd = buf.indexOf("\r\n\r\n", start, "utf8");
      if (headerEnd === -1)
        break;
      const header = buf.toString("utf8", start, headerEnd);
      const bodyStart = headerEnd + 4;
      const next = buf.indexOf(sep2, bodyStart);
      if (next === -1)
        break;
      const bodyEnd = next - 2;
      const part = buf.subarray(bodyStart, bodyEnd);
      const nameM = /name="([^"]+)"/.exec(header);
      const fileM = /filename="([^"]*)"/.exec(header);
      const name = nameM ? nameM[1] : "";
      if (fileM && fileM[1]) {
        files.push({ filename: fileM[1], data: Buffer.from(part) });
      } else if (name) {
        fields[name] = part.toString("utf8");
      }
      start = next + sep2.length;
    }
    return { fields, files };
  }
  async handle(req, res) {
    const url = new import_url.URL(req.url ?? "/", `http://${req.headers.host}`);
    const pathName = url.pathname;
    if (pathName === "/api/login" && req.method === "POST") {
      const body = await this.readJson(req);
      if (!this.opts.password || body.password === this.opts.password) {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Set-Cookie": `arp_token=${this.token()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
        });
        res.end(JSON.stringify({ ok: true, token: this.token() }));
      } else {
        this.json(res, 401, { error: "wrong password" });
      }
      return;
    }
    if (pathName.startsWith("/api/")) {
      if (!this.isAuthed(req)) {
        this.json(res, 401, { error: "unauthorized" });
        return;
      }
      return this.handleApi(pathName, req, res, url);
    }
    this.serveStatic(pathName, res);
  }
  async handleApi(pathName, req, res, url) {
    const route = pathName.replace(/^\/api\//, "");
    if (route === "events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      res.write(`retry: 2000

`);
      this.sseClients.add(res);
      req.on("close", () => this.sseClients.delete(res));
      this.chat.buildState().then((state) => {
        res.write(`data: ${JSON.stringify({ type: "state", state })}

`);
      });
      return;
    }
    switch (route) {
      case "state": {
        const id = url.searchParams.get("cascadeId") ?? void 0;
        return this.json(res, 200, await this.chat.buildState(id));
      }
      case "trajectories":
        return this.json(res, 200, { list: await this.chat.getTrajectories() });
      case "quota":
        return this.json(res, 200, await this.chat.getQuota() ?? {});
      case "models":
        return this.json(res, 200, { models: await this.chat.getModels() });
      case "screenshot": {
        const b64 = await this.chat.captureScreenshot();
        if (!b64)
          return this.json(res, 200, { ok: false });
        return this.json(res, 200, { ok: true, dataUri: `data:image/png;base64,${b64}` });
      }
      case "new-chat":
        await this.chat.newChat();
        return this.json(res, 200, { ok: true });
      case "send": {
        const body = await this.readJson(req);
        const text = String(body.text || "");
        const images = Array.isArray(body.images) ? body.images : void 0;
        await this.chat.sendMessage(text, images);
        return this.json(res, 200, { ok: true });
      }
      case "slash-command": {
        const body = await this.readJson(req);
        await this.chat.sendSlashCommand(
          String(body.name ?? ""),
          String(body.modelFacingText ?? ""),
          String(body.text ?? "")
        );
        return this.json(res, 200, { ok: true });
      }
      case "mention-conversation": {
        const body = await this.readJson(req);
        await this.chat.sendWithConversationMention(
          {
            id: String(body.id ?? ""),
            title: body.title ? String(body.title) : void 0,
            lastModifiedTime: body.lastModifiedTime ? String(body.lastModifiedTime) : void 0
          },
          String(body.text ?? "")
        );
        return this.json(res, 200, { ok: true });
      }
      case "switch": {
        const body = await this.readJson(req);
        await this.chat.switchCascade(String(body.cascadeId ?? ""));
        return this.json(res, 200, { ok: true });
      }
      case "select-model": {
        const body = await this.readJson(req);
        const ok = await this.chat.selectModel(String(body.modelId ?? ""));
        return this.json(res, 200, { ok });
      }
      case "cancel":
        return this.json(res, 200, { ok: await this.chat.cancel() });
      case "revert": {
        const body = await this.readJson(req);
        const stepIndex = Number(body.stepIndex);
        if (!Number.isFinite(stepIndex)) {
          return this.json(res, 400, { ok: false, error: "stepIndex required" });
        }
        const ok = await this.chat.revertToStep(stepIndex);
        return this.json(res, 200, { ok });
      }
      case "answer-question": {
        const body = await this.readJson(req);
        const stepIndex = Number(body.stepIndex);
        const answers = Array.isArray(body.answers) ? body.answers : [];
        if (!Number.isFinite(stepIndex)) {
          return this.json(res, 400, { ok: false, error: "stepIndex required" });
        }
        const ok = await this.chat.answerQuestion(
          stepIndex,
          answers.map((a) => ({
            selectedOptionIds: Array.isArray(a?.selectedOptionIds) ? a.selectedOptionIds.map(String) : [],
            freeText: a?.freeText ? String(a.freeText) : void 0
          }))
        );
        return this.json(res, 200, { ok });
      }
      case "skip-question": {
        const body = await this.readJson(req);
        const stepIndex = Number(body.stepIndex);
        if (!Number.isFinite(stepIndex)) {
          return this.json(res, 400, { ok: false, error: "stepIndex required" });
        }
        const ok = await this.chat.skipQuestion(stepIndex);
        return this.json(res, 200, { ok });
      }
      case "slash-commands":
        return this.json(res, 200, {
          commands: await this.chat.getSlashCommands()
        });
      case "approve-plan": {
        const body = await this.readJson(req);
        const artifactUri = String(body.artifactUri ?? "");
        if (!artifactUri) {
          return this.json(res, 400, { ok: false, error: "artifactUri required" });
        }
        const ok = await this.chat.approvePlan(
          artifactUri,
          body.approved !== false
        );
        return this.json(res, 200, { ok });
      }
      case "files": {
        const rel = url.searchParams.get("path") ?? "";
        return this.json(res, 200, {
          root: FileController.root(),
          entries: FileController.list(rel)
        });
      }
      case "file": {
        if (req.method === "GET") {
          const rel = url.searchParams.get("path") ?? "";
          return this.json(res, 200, FileController.read(rel));
        }
        if (req.method === "PUT" || req.method === "POST") {
          const body = await this.readJson(req);
          return this.json(
            res,
            200,
            FileController.write(String(body.path ?? ""), String(body.text ?? ""))
          );
        }
        if (req.method === "DELETE") {
          const rel = url.searchParams.get("path") ?? "";
          return this.json(res, 200, FileController.delete(rel));
        }
        break;
      }
      case "file-open": {
        const body = await this.readJson(req);
        const ok = await FileController.openInEditor(String(body.path ?? ""));
        return this.json(res, 200, { ok });
      }
      case "upload": {
        const ct = String(req.headers["content-type"] ?? "");
        const buf = await this.readBody(req);
        const { files } = this.parseMultipart(buf, ct);
        const saved = [];
        const absPaths = [];
        for (const f of files) {
          const r = FileController.saveUpload(f.filename, f.data);
          if ("path" in r) {
            saved.push(r.path);
            absPaths.push(r.abs);
          }
        }
        return this.json(res, 200, { saved, absPaths });
      }
      case "git/status":
        return this.json(res, 200, await GitController.status());
      case "git/log":
        return this.json(res, 200, {
          commits: await GitController.log(
            Number(url.searchParams.get("limit") ?? 20)
          )
        });
      case "git/diff": {
        const file = url.searchParams.get("file") ?? void 0;
        return this.json(res, 200, { diff: await GitController.diff(file) });
      }
      case "git/add": {
        const body = await this.readJson(req);
        return this.json(res, 200, await GitController.add(body.files ?? "."));
      }
      case "git/commit": {
        const body = await this.readJson(req);
        return this.json(
          res,
          200,
          await GitController.commit(String(body.message ?? ""))
        );
      }
      case "git/push": {
        const body = await this.readJson(req);
        return this.json(
          res,
          200,
          await GitController.push(body.branch, body.setUpstream)
        );
      }
      case "git/pull":
        return this.json(res, 200, await GitController.pull());
      case "git/branch":
        if (req.method === "POST") {
          const body = await this.readJson(req);
          return this.json(
            res,
            200,
            await GitController.createBranch(String(body.name ?? ""))
          );
        }
        return this.json(res, 200, { branches: await GitController.branches() });
      case "git/checkout": {
        const body = await this.readJson(req);
        return this.json(
          res,
          200,
          await GitController.checkout(String(body.branch ?? ""))
        );
      }
      case "gh/pr-create": {
        const body = await this.readJson(req);
        return this.json(
          res,
          200,
          await GitController.createPR(
            String(body.title ?? ""),
            String(body.body ?? "")
          )
        );
      }
      case "gh/pr-list":
        return this.json(res, 200, { prs: await GitController.listPRs() });
      case "stats": {
        const stats = this.chat.getTodayStats();
        return this.json(res, 200, stats);
      }
      case "reset-stats": {
        const stats = this.chat.resetTodayStats();
        return this.json(res, 200, stats);
      }
      case "media": {
        const u = new import_url.URL(req.url ?? "", "http://localhost");
        let filePath = u.searchParams.get("path") || "";
        if (filePath.startsWith("file://")) {
          filePath = decodeURIComponent(filePath.replace(/^file:\/\//, ""));
        }
        if (!filePath || !fs5.existsSync(filePath)) {
          return this.json(res, 404, { error: "file not found" });
        }
        let ext = path4.extname(filePath).toLowerCase();
        let contentType = "image/png";
        if (ext === ".jpg" || ext === ".jpeg")
          contentType = "image/jpeg";
        else if (ext === ".webp")
          contentType = "image/webp";
        else if (ext === ".gif")
          contentType = "image/gif";
        else if (ext === ".svg")
          contentType = "image/svg+xml";
        else {
          try {
            const buf = Buffer.alloc(8);
            const fd = fs5.openSync(filePath, "r");
            fs5.readSync(fd, buf, 0, 8, 0);
            fs5.closeSync(fd);
            if (buf[0] === 255 && buf[1] === 216)
              contentType = "image/jpeg";
            else if (buf[0] === 137 && buf[1] === 80)
              contentType = "image/png";
            else if (buf[0] === 71 && buf[1] === 73)
              contentType = "image/gif";
            else if (buf[0] === 82 && buf[1] === 73)
              contentType = "image/webp";
          } catch {
          }
        }
        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS"
        });
        fs5.createReadStream(filePath).pipe(res);
        return;
      }
      case "account":
        return this.json(res, 200, SettingsController.account());
      case "switch-account": {
        const body = await this.readJson(req);
        const r = await SettingsController.switchAccount(String(body.email ?? ""));
        return this.json(res, 200, r);
      }
      case "settings": {
        if (req.method === "GET") {
          return this.json(res, 200, SettingsController.get());
        }
        if (req.method === "PUT" || req.method === "POST") {
          const body = await this.readJson(req);
          const updated = await SettingsController.update(body ?? {});
          this.opts.onSettingsChanged?.(updated);
          return this.json(res, 200, updated);
        }
        break;
      }
      case "workspace": {
        if (req.method === "GET") {
          return this.json(res, 200, {
            current: SettingsController.currentWorkspace()
          });
        }
        if (req.method === "POST") {
          const body = await this.readJson(req);
          return this.json(
            res,
            200,
            await SettingsController.openWorkspace(String(body.path ?? ""))
          );
        }
        break;
      }
      case "browse": {
        const dir = url.searchParams.get("path") ?? void 0;
        return this.json(res, 200, SettingsController.browse(dir));
      }
      case "workspace-folders":
        return this.json(res, 200, SettingsController.workspaceFolders());
      case "workspace-create": {
        if (req.method === "POST") {
          const body = await this.readJson(req);
          const name = String(body.name ?? "").trim();
          if (!name)
            return this.json(res, 400, { ok: false, error: "name required" });
          try {
            const root = SettingsController.get().workspaceRoot;
            if (!root)
              throw new Error("Workspace root not configured");
            const target = path4.join(root, name);
            if (!target.startsWith(root))
              throw new Error("Invalid name");
            fs5.mkdirSync(target, { recursive: true });
            return this.json(res, 200, { ok: true, path: target });
          } catch (e) {
            return this.json(res, 500, { ok: false, error: e.message });
          }
        }
        break;
      }
      case "term/list":
        return this.json(res, 200, { terminals: this.terminals.list() });
      case "term/create": {
        const body = await this.readJson(req);
        const info = this.terminals.create(
          body.cwd ? String(body.cwd) : void 0,
          body.title ? String(body.title) : void 0
        );
        return this.json(res, 200, info);
      }
      case "term/input": {
        const body = await this.readJson(req);
        const ok = this.terminals.write(String(body.id ?? ""), String(body.data ?? ""));
        return this.json(res, 200, { ok });
      }
      case "term/kill": {
        const body = await this.readJson(req);
        const ok = this.terminals.kill(String(body.id ?? ""));
        return this.json(res, 200, { ok });
      }
      case "term/buffer": {
        const id = url.searchParams.get("id") ?? "";
        return this.json(res, 200, { buffer: this.terminals.getBuffer(id) });
      }
    }
    this.json(res, 404, { error: "not found" });
  }
  serveStatic(pathName, res) {
    let rel = pathName === "/" ? "/index.html" : pathName;
    rel = rel.split("?")[0];
    const abs = path4.join(this.opts.webRoot, rel);
    if (!abs.startsWith(this.opts.webRoot)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    fs5.readFile(abs, (err, data) => {
      if (err) {
        const indexPath = path4.join(this.opts.webRoot, "index.html");
        fs5.readFile(indexPath, (err2, idx) => {
          if (err2) {
            res.writeHead(404);
            res.end("not found");
          } else {
            res.writeHead(200, { "Content-Type": MIME[".html"] });
            res.end(idx);
          }
        });
        return;
      }
      const ext = path4.extname(abs).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME[ext] ?? "application/octet-stream"
      });
      res.end(data);
    });
  }
};

// src/telegram.ts
var https2 = __toESM(require("https"));
var fs6 = __toESM(require("fs"));
var path5 = __toESM(require("path"));
var TG_LIMIT = 3900;
function api(token, method, body) {
  const payload = JSON.stringify(body ?? {});
  return new Promise((resolve3) => {
    const req = https2.request(
      {
        host: "api.telegram.org",
        path: `/bot${token}/${method}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        },
        timeout: 65e3
      },
      (res) => {
        let data = "";
        res.on("data", (c) => data += c.toString());
        res.on("end", () => {
          try {
            resolve3(JSON.parse(data));
          } catch {
            resolve3(null);
          }
        });
      }
    );
    req.on("error", () => resolve3(null));
    req.on("timeout", () => {
      req.destroy();
      resolve3(null);
    });
    req.write(payload);
    req.end();
  });
}
var HELP = [
  "*Antigravity Remote Plus*",
  "",
  "Send any text to chat with the AI.",
  "Send a photo/file to attach it to the workspace.",
  "",
  "/new \u2014 new chat",
  "/history \u2014 list conversations",
  "/cancel \u2014 stop generation",
  "/revert \u2014 undo last change",
  "/quota \u2014 model quota",
  "/models \u2014 list models",
  "/screenshot \u2014 capture IDE screen",
  "/file <path> \u2014 send a workspace file (images shown as photo)",
  "/status \u2014 git status",
  "/commit <msg> \u2014 stage all + commit",
  "/push \u2014 git push",
  "/pull \u2014 git pull",
  "/help \u2014 this help"
].join("\n");
function splitChunks(text, limit = TG_LIMIT) {
  if (text.length <= limit)
    return [text];
  const chunks = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5)
      cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest)
    chunks.push(rest);
  return chunks;
}
var IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
var TelegramBridge = class {
  constructor(opts, chat2) {
    this.offset = 0;
    this.running = false;
    this.statusMsgId = null;
    this.lastStatusText = "";
    // Text of every assistant message we've already forwarded to Telegram.
    // Using a Set (keyed by first 200 chars) prevents re-delivery across polls
    // while still catching genuinely new messages even if they appear at a
    // non-last position in the messages array.
    this.deliveredAssistantTexts = /* @__PURE__ */ new Set();
    this.unsub = null;
    // A "turn" is active from when the user sends a message until the agent's
    // answer is delivered. We only manage the single status message during a turn
    // — idle status events (e.g. the poller settling) must NOT spawn "AI: xong".
    this.turnActive = false;
    // Each call to beginTurn() increments this counter. Async status/finishTurn
    // callbacks capture the counter at dispatch time and bail out early if a
    // newer turn has already started — this prevents the race condition where
    // status events from turn N edit the status message created for turn N+1.
    this.turnId = 0;
    // The cascade we're currently mirroring. When it changes (user switched or
    // the bridge (re)started), we seed our "seen" markers from the loaded
    // transcript WITHOUT re-sending it — that's what caused old messages to be
    // resent on reconnect/switch.
    this.currentCascade = "";
    // Artifact URIs we've already offered a view-button for, so we don't repeat.
    this.deliveredArtifacts = /* @__PURE__ */ new Set();
    // Step indices of ask_question cards we've already presented to Telegram.
    this.deliveredQuestions = /* @__PURE__ */ new Set();
    // Map of short keys (e.g. u_1) -> full file URIs to stay under Telegram's 64-byte callback_data cap.
    this.uriMap = /* @__PURE__ */ new Map();
    this.opts = opts;
    this.chat = chat2;
    this.ownerChatId = opts.chatId?.trim() ?? "";
  }
  encodeUriKey(uri) {
    if (!uri)
      return "";
    for (const [k, v] of this.uriMap.entries()) {
      if (v === uri)
        return k;
    }
    const key = `u_${this.uriMap.size + 1}`;
    this.uriMap.set(key, uri);
    return key;
  }
  resolveUriKey(key) {
    return this.uriMap.get(key) || key;
  }
  async start() {
    if (this.running)
      return;
    if (!this.opts.token) {
      this.opts.log("[telegram] no token configured; not starting");
      return;
    }
    this.running = true;
    this.opts.log("[telegram] starting long-poll");
    await this.drainBacklog();
    this.unsub = this.chat.onEvent((e) => this.onChatEvent(e));
    this.loop().catch(
      (err) => this.opts.log(`[telegram] loop error: ${err?.message ?? err}`)
    );
    if (this.ownerChatId) {
      const me = await api(this.opts.token, "getMe", {});
      const uname = me?.result?.username ? `@${me.result.username}` : "bot";
      await this.send(
        this.ownerChatId,
        `*Antigravity Remote Plus* \u0111\xE3 k\u1EBFt n\u1ED1i (${uname}).
G\u1EEDi tin nh\u1EAFn \u0111\u1EC3 chat v\u1EDBi AI, ho\u1EB7c /help \u0111\u1EC3 xem l\u1EC7nh.`,
        "Markdown"
      );
    }
  }
  stop() {
    this.running = false;
    this.unsub?.();
    this.unsub = null;
  }
  // Fast-forward past any updates that queued while offline (getUpdates with a
  // large offset after reading the current backlog) so a restart doesn't replay
  // stale messages/commands.
  async drainBacklog() {
    const res = await api(this.opts.token, "getUpdates", { timeout: 0, offset: -1 });
    if (res?.ok && Array.isArray(res.result) && res.result.length) {
      this.offset = res.result[res.result.length - 1].update_id + 1;
    }
  }
  allowed(chatId) {
    const id = String(chatId);
    if (!this.ownerChatId) {
      this.ownerChatId = id;
      return true;
    }
    return id === this.ownerChatId;
  }
  async loop() {
    while (this.running) {
      const res = await api(this.opts.token, "getUpdates", {
        offset: this.offset,
        timeout: 50,
        allowed_updates: ["message", "callback_query"]
      });
      if (!res || !res.ok) {
        await delay2(2e3);
        continue;
      }
      for (const u of res.result) {
        this.offset = u.update_id + 1;
        try {
          await this.handleUpdate(u);
        } catch (err) {
          this.opts.log(`[telegram] handle error: ${err?.message ?? err}`);
        }
      }
    }
  }
  async handleUpdate(u) {
    if (u.callback_query) {
      const cq = u.callback_query;
      const chatId2 = cq.message?.chat.id;
      if (chatId2 === void 0 || !this.allowed(chatId2))
        return;
      await api(this.opts.token, "answerCallbackQuery", {
        callback_query_id: cq.id
      });
      const data = cq.data ?? "";
      if (data.startsWith("switch:")) {
        await this.chat.switchCascade(data.slice(7));
        await this.send(String(chatId2), "Switched conversation.");
      } else if (data.startsWith("model:")) {
        const ok = await this.chat.selectModel(data.slice(6));
        await this.send(String(chatId2), ok ? "Model selected." : "Could not switch model.");
      } else if (data.startsWith("view:")) {
        const key = data.slice(5);
        const fullUri = this.resolveUriKey(key);
        await this.sendFile(String(chatId2), fullUri);
      } else if (data.startsWith("plan:")) {
        const rest = data.slice(5);
        const sep2 = rest.indexOf(":");
        const verdict = rest.slice(0, sep2);
        const key = rest.slice(sep2 + 1);
        const fullUri = this.resolveUriKey(key);
        await this.beginTurn();
        const ok = await this.chat.approvePlan(fullUri, verdict === "approve");
        if (ok) {
          await this.updateStatus(
            String(chatId2),
            verdict === "approve" ? "[OK] \u0110\xE3 \u0111\u1ED3ng \xFD k\u1EBF ho\u1EA1ch. AI \u0111ang ti\u1EBFn h\xE0nh th\u1EF1c thi\u2026" : "[T\u1EEB ch\u1ED1i] \u0110\xE3 t\u1EEB ch\u1ED1i k\u1EBF ho\u1EA1ch."
          );
        } else {
          await this.send(String(chatId2), "Kh\xF4ng g\u1EEDi \u0111\u01B0\u1EE3c ph\u1EA3n h\u1ED3i k\u1EBF ho\u1EA1ch.");
        }
      } else if (data.startsWith("ask:")) {
        const parts = data.split(":");
        const stepIdx = parseInt(parts[1], 10);
        const qIdx = parseInt(parts[2], 10);
        const optId = parts[3];
        if (!isNaN(stepIdx) && optId) {
          await this.beginTurn();
          const ok = await this.chat.answerQuestion(stepIdx, [
            { selectedOptionIds: [optId] }
          ]);
          if (ok) {
            await this.updateStatus(String(chatId2), "[G\u1EEDi] \u0110\xE3 g\u1EEDi l\u1EF1a ch\u1ECDn cho AI. \u0110ang x\u1EED l\xFD\u2026");
          } else {
            await this.send(String(chatId2), "[L\u1ED7i] Kh\xF4ng g\u1EEDi \u0111\u01B0\u1EE3c l\u1EF1a ch\u1ECDn.");
          }
        }
      } else if (data.startsWith("ask_skip:")) {
        const stepIdx = parseInt(data.slice(9), 10);
        if (!isNaN(stepIdx)) {
          await this.beginTurn();
          const ok = await this.chat.skipQuestion(stepIdx);
          if (ok) {
            await this.updateStatus(String(chatId2), "[OK] \u0110\xE3 b\u1ECF qua c\xE2u h\u1ECFi. \u0110ang x\u1EED l\xFD\u2026");
          } else {
            await this.send(String(chatId2), "[L\u1ED7i] Kh\xF4ng b\u1ECF qua \u0111\u01B0\u1EE3c c\xE2u h\u1ECFi.");
          }
        }
      }
      return;
    }
    const msg = u.message;
    if (!msg)
      return;
    const chatId = msg.chat.id;
    if (!this.allowed(chatId)) {
      await this.send(String(chatId), "Not authorized.");
      return;
    }
    const chatIdStr = String(chatId);
    if (msg.document || msg.photo) {
      await this.handleIncomingFile(msg, chatIdStr);
      return;
    }
    const text = (msg.text ?? "").trim();
    if (!text)
      return;
    if (text.startsWith("/")) {
      await this.handleCommand(text, chatIdStr);
      return;
    }
    await this.beginTurn();
    await this.chat.sendMessage(text);
    await this.updateStatus(chatIdStr, "[G\u1EEDi] \u0110\xE3 g\u1EEDi cho AI. \u0110ang x\u1EED l\xFD\u2026");
  }
  async handleCommand(text, chatId) {
    const [cmd, ...rest] = text.split(/\s+/);
    const arg = rest.join(" ").trim();
    switch (cmd.toLowerCase()) {
      case "/start":
      case "/help":
        await this.send(chatId, HELP, "Markdown");
        break;
      case "/new":
        await this.chat.newChat();
        await this.send(chatId, "Started a new chat.");
        break;
      case "/cancel":
        await this.chat.cancel();
        await this.send(chatId, "Cancelled.");
        break;
      case "/revert": {
        const ok = await this.chat.revertLatest();
        await this.send(
          chatId,
          ok ? "Reverted to the last checkpoint." : "Nothing to revert."
        );
        break;
      }
      case "/screenshot":
      case "/cap": {
        await this.updateStatus(chatId, "[Ch\u1EE5p \u1EA3nh] \u0110ang ch\u1EE5p m\xE0n h\xECnh IDE\u2026");
        const b64 = await this.chat.captureScreenshot();
        if (b64) {
          const buf = Buffer.from(b64, "base64");
          await this.sendPhoto(chatId, buf, `ide_screenshot_${Date.now()}.png`);
        } else {
          await this.send(chatId, "[L\u1ED7i] Kh\xF4ng th\u1EC3 ch\u1EE5p m\xE0n h\xECnh IDE (CDP ch\u01B0a k\u1EBFt n\u1ED1i).");
        }
        break;
      }
      case "/file": {
        if (!arg) {
          await this.send(chatId, "Usage: /file <workspace-relative-or-absolute path>");
          break;
        }
        await this.sendFile(chatId, arg);
        break;
      }
      case "/quota": {
        const q = await this.chat.getQuota();
        await this.send(chatId, "```\n" + JSON.stringify(q?.usage ?? q ?? {}, null, 2).slice(0, 3500) + "\n```", "Markdown");
        break;
      }
      case "/models": {
        const models = await this.chat.getModels();
        if (!models.length) {
          await this.send(chatId, "No models reported.");
          break;
        }
        await api(this.opts.token, "sendMessage", {
          chat_id: chatId,
          text: "Choose a model:",
          reply_markup: {
            inline_keyboard: models.map((m) => [
              { text: (m.selected ? "* " : "") + m.label, callback_data: `model:${m.id}` }
            ])
          }
        });
        break;
      }
      case "/history": {
        const list = await this.chat.getTrajectories();
        if (!list.length) {
          await this.send(chatId, "No conversations found.");
          break;
        }
        const recent = list.slice(0, 10);
        await api(this.opts.token, "sendMessage", {
          chat_id: chatId,
          text: "Recent conversations:",
          reply_markup: {
            inline_keyboard: recent.map((t) => [
              {
                text: (t.title ?? t.id).slice(0, 50),
                callback_data: `switch:${t.id}`
              }
            ])
          }
        });
        break;
      }
      case "/status": {
        const st = await GitController.status();
        const lines = [
          `Branch: ${st.branch} (ahead ${st.ahead}, behind ${st.behind})`,
          ...st.files.slice(0, 40).map((f) => `${f.index}${f.work} ${f.path}`)
        ];
        await this.send(chatId, "```\n" + lines.join("\n").slice(0, 3500) + "\n```", "Markdown");
        break;
      }
      case "/commit": {
        if (!arg) {
          await this.send(chatId, "Usage: /commit <message>");
          break;
        }
        await GitController.stageAll();
        const r = await GitController.commit(arg);
        await this.send(chatId, r.message.slice(0, 3500) || (r.ok ? "Committed." : "Commit failed."));
        break;
      }
      case "/push": {
        const r = await GitController.push();
        await this.send(chatId, r.message.slice(0, 3500) || (r.ok ? "Pushed." : "Push failed."));
        break;
      }
      case "/pull": {
        const r = await GitController.pull();
        await this.send(chatId, r.message.slice(0, 3500) || (r.ok ? "Pulled." : "Pull failed."));
        break;
      }
      default:
        await this.send(chatId, "Unknown command. /help for options.");
    }
  }
  // Send a workspace or brain artifact file to the chat. Images go as a photo;
  // text files send inline formatted HTML; larger files send as a document.
  async sendFile(chatId, rawPath) {
    const filePath = rawPath.replace(/^file:\/\//, "");
    let data = null;
    if (path5.isAbsolute(filePath) && fs6.existsSync(filePath)) {
      try {
        data = fs6.readFileSync(filePath);
      } catch {
        data = null;
      }
    }
    if (!data) {
      data = FileController.readBinary(filePath);
    }
    if (!data) {
      await this.send(chatId, `[L\u1ED7i] Kh\xF4ng \u0111\u1ECDc \u0111\u01B0\u1EE3c t\u1EC7p: ${rawPath}`);
      return;
    }
    const name = filePath.split(/[\\/]/).pop() || "file";
    if (IMAGE_EXT.test(name)) {
      await this.sendPhoto(chatId, data, name);
    } else if (data.length < 3800 && /\.(md|txt|json|ya?ml|js|ts|py|sh|css|html?)$/i.test(name)) {
      const content = data.toString("utf8").slice(0, 3800);
      await api(this.opts.token, "sendMessage", {
        chat_id: chatId,
        text: `[File] <b>${name}</b>

${mdToTgHtml(content)}`,
        parse_mode: "HTML"
      });
    } else {
      await this.sendDocument(chatId, data, name);
    }
  }
  async handleIncomingFile(msg, chatId) {
    const isPhoto = Boolean(msg.photo && msg.photo.length);
    const fileId = msg.document?.file_id ?? msg.photo?.[msg.photo.length - 1]?.file_id;
    const name = msg.document?.file_name ?? `photo_${Date.now()}.jpg`;
    if (!fileId)
      return;
    const info = await api(this.opts.token, "getFile", { file_id: fileId });
    const filePath = info?.result?.file_path;
    if (!filePath) {
      await this.send(chatId, "[L\u1ED7i] Could not fetch file.");
      return;
    }
    const data = await this.download(
      `https://api.telegram.org/file/bot${this.opts.token}/${filePath}`
    );
    if (!data) {
      await this.send(chatId, "[L\u1ED7i] Download failed.");
      return;
    }
    const mime = msg.document?.mime_type || (IMAGE_EXT.test(name) ? `image/${(name.split(".").pop() || "png").toLowerCase().replace("jpg", "jpeg")}` : "");
    const isImage = isPhoto || (mime.startsWith("image/") ?? false) || IMAGE_EXT.test(name);
    if (isImage) {
      const caption = (msg.caption ?? "").trim();
      await this.beginTurn();
      await this.chat.sendWithMedia(caption, [
        {
          base64: data.toString("base64"),
          mimeType: mime || "image/jpeg",
          name
        }
      ]);
      await this.updateStatus(chatId, "[G\u1EEDi] \u0110\xE3 g\u1EEDi \u1EA3nh cho AI. \u0110ang x\u1EED l\xFD\u2026");
      return;
    }
    const r = FileController.saveUpload(name, data);
    if ("path" in r) {
      await this.send(chatId, `[OK] Saved to workspace: ${r.path}`);
    } else {
      await this.send(chatId, `[L\u1ED7i] Save failed: ${r.error}`);
    }
  }
  download(url) {
    return new Promise((resolve3) => {
      https2.get(url, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve3(Buffer.concat(chunks)));
      }).on("error", () => resolve3(null));
    });
  }
  // Begin a turn when the user sends a message: force a FRESH status message on
  // the next update (so we never edit a previous turn's message) and mark the
  // turn active so status events are mirrored. Incrementing turnId ensures that
  // any in-flight async callbacks from the previous turn will see a mismatched
  // id and abort rather than editing this turn's status message.
  async beginTurn() {
    this.turnId++;
    this.turnActive = true;
    this.statusMsgId = null;
    this.lastStatusText = "";
    const state = await this.chat.getState().catch(() => null);
    const currentMsgs = state?.messages ?? [];
    for (const m of currentMsgs) {
      if (m.role === "assistant" && m.text) {
        this.deliveredAssistantTexts.add(assistantKey(m.text));
      }
      if ((m.role === "artifact" || m.role === "plan") && m.meta?.artifactUri) {
        this.deliveredArtifacts.add(String(m.meta.artifactUri));
      }
      if (m.role === "ask") {
        this.deliveredQuestions.add(`ask_${m.stepIndex ?? m.text}`);
      }
    }
    this.opts.log(
      `[tg] beginTurn id=${this.turnId}, seeded deliveredAssistants=${this.deliveredAssistantTexts.size}`
    );
  }
  onChatEvent(e) {
    if (!this.ownerChatId)
      return;
    const myTurnId = this.turnId;
    if (e.type === "state") {
      if (e.state.cascadeId !== this.currentCascade) {
        this.opts.log(
          `[tg] cascade switch: ${this.currentCascade || "(none)"} -> ${e.state.cascadeId || "(empty)"} turnActive=${this.turnActive}`
        );
        this.currentCascade = e.state.cascadeId;
        const assistant2 = e.state.messages.filter((m) => m.role === "assistant");
        if (!this.turnActive) {
          this.deliveredAssistantTexts = new Set(
            assistant2.map((m) => assistantKey(m.text))
          );
          this.deliveredArtifacts = new Set(
            e.state.messages.filter((m) => m.role === "artifact" || m.role === "plan").map((m) => String(m.meta?.artifactUri ?? "")).filter(Boolean)
          );
          this.deliveredQuestions = /* @__PURE__ */ new Set();
          this.statusMsgId = null;
        }
        if (!this.turnActive)
          return;
      }
      if (!this.turnActive)
        return;
      this.opts.log(
        `[tg] state event: cascade=${e.state.cascadeId.slice(0, 8)} generating=${e.state.generating} msgs=${e.state.messages.length} delivered=${this.deliveredAssistantTexts.size}`
      );
      const assistant = e.state.messages.filter((m) => m.role === "assistant");
      const newMsgs = [];
      for (const m of assistant) {
        if (!m.text)
          continue;
        const key = assistantKey(m.text);
        if (!this.deliveredAssistantTexts.has(key)) {
          this.deliveredAssistantTexts.add(key);
          newMsgs.push(m);
        }
      }
      if (newMsgs.length > 0) {
        this.opts.log(
          `[tg] delivering ${newMsgs.length} new assistant message(s) (generating=${e.state.generating})` + (newMsgs[0] ? ` first="${newMsgs[0].text.slice(0, 60)}"` : "")
        );
        for (const msg of newMsgs) {
          void this.finishTurn(this.ownerChatId, msg.text, e.state.messages, myTurnId);
        }
      }
      void this.deliverInteractiveElements(this.ownerChatId, e.state.messages);
    } else if (e.type === "status") {
      if (!this.turnActive)
        return;
      if (e.generating) {
        this.opts.log(`[tg] status: ${e.statusText}`);
        void this.updateStatus(
          this.ownerChatId,
          `[AI] ${e.statusText || "\u0111ang x\u1EED l\xFD\u2026"}`,
          myTurnId
        );
      }
    }
  }
  // Deliver an assistant answer from the current turn. Multi-step agents
  // (plan → tool calls → final reply) can produce multiple assistant messages
  // within one turn. We deliver each new one as it appears and keep the turn
  // active so subsequent answers are not missed. The turn only truly ends when
  // the user sends a new message (beginTurn) or the cascade switches.
  //
  // `turnId` is captured at event-dispatch time. If a newer turn has already
  // started, we skip the status-message edit but still deliver the text.
  async finishTurn(chatId, answer, messages, turnId) {
    this.opts.log(`[tg] finishTurn: answer="${answer.slice(0, 80)}" isCurrent=${turnId === this.turnId}`);
    const isCurrent = turnId === this.turnId;
    if (isCurrent) {
      await this.updateStatus(chatId, "[Done] AI: xong", turnId);
      this.statusMsgId = null;
    }
    this.opts.log(`[tg] delivering answer (${answer.length} chars)`);
    await this.deliverText(chatId, answer);
    await this.deliverInteractiveElements(chatId, messages);
    this.opts.log(`[tg] finishTurn complete`);
  }
  // Send any not-yet-seen artifact files as inline "view" buttons, plans as
  // approve/reject buttons, and ask_question prompts as option button cards.
  async deliverInteractiveElements(chatId, messages) {
    for (const m of messages) {
      if (m.role === "artifact" || m.role === "plan") {
        const uri = String(m.meta?.artifactUri ?? "");
        if (!uri || this.deliveredArtifacts.has(uri))
          continue;
        this.deliveredArtifacts.add(uri);
        const uriKey = this.encodeUriKey(uri);
        const name = decodeURIComponent(uri.split(/[\\/]/).pop() || "file");
        const rows = [];
        if (m.role === "plan" && !m.meta?.answered) {
          rows.push([
            { text: "[OK] \u0110\u1ED3ng \xFD (Approve)", callback_data: `plan:approve:${uriKey}` },
            { text: "[X] T\u1EEB ch\u1ED1i (Reject)", callback_data: `plan:reject:${uriKey}` }
          ]);
        }
        rows.push([{ text: `[File] Xem t\u1EC7p ${name}`, callback_data: `view:${uriKey}` }]);
        let planText = m.role === "plan" ? `\u{1F4CB} *K\u1EBF ho\u1EA1ch tri\u1EC3n khai:*

${mdToTgHtml(m.text || "")}` : `\u{1F4CE} T\u1EC7p \u0111\xEDnh k\xE8m: ${name}`;
        if (planText.length > 3800) {
          planText = planText.slice(0, 3800) + "\n\n...(b\u1EA5m Xem t\u1EC7p \u0111\u1EC3 \u0111\u1ECDc \u0111\u1EA7y \u0111\u1EE7)";
        }
        await api(this.opts.token, "sendMessage", {
          chat_id: chatId,
          text: planText,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: rows }
        });
      } else if (m.role === "ask") {
        const stepIndex = m.stepIndex;
        const qKey = `ask_${stepIndex ?? m.text}`;
        if (this.deliveredQuestions.has(qKey) || m.meta?.answered)
          continue;
        this.deliveredQuestions.add(qKey);
        const questions = Array.isArray(m.meta?.questions) ? m.meta.questions : [];
        if (questions.length === 0)
          continue;
        for (let qi = 0; qi < questions.length; qi++) {
          const q = questions[qi];
          const questionTitle = q?.question ?? m.text ?? "Agent c\xF3 c\xE2u h\u1ECFi:";
          const options = Array.isArray(q?.options) ? q.options : [];
          const rows = [];
          for (let oi = 0; oi < options.length; oi++) {
            const opt = options[oi];
            const optId = String(opt.id ?? oi);
            const optText = String(opt.text ?? `Option ${oi + 1}`);
            rows.push([
              {
                text: `${oi + 1}. ${optText}`,
                callback_data: `ask:${stepIndex}:${qi}:${optId}`
              }
            ]);
          }
          rows.push([
            {
              text: "\u23ED B\u1ECF qua (Skip)",
              callback_data: `ask_skip:${stepIndex}`
            }
          ]);
          this.opts.log(`[tg] delivering ask question: "${questionTitle.slice(0, 40)}" with ${options.length} options`);
          await api(this.opts.token, "sendMessage", {
            chat_id: chatId,
            text: `\u2753 *C\xE2u h\u1ECFi t\u1EEB Agent:*

${mdToTgHtml(questionTitle)}`,
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: rows }
          });
        }
      }
    }
  }
  // Deliver a possibly-long text as one or more messages, converting the AI's
  // markdown to Telegram HTML format (parse_mode=HTML). Automatically detects
  // artifact file links (implementation_plan.md, walkthrough.md, etc.) embedded in
  // the text and appends action buttons (Approve / Reject / View) to the last chunk.
  async deliverText(chatId, text) {
    const artifactButtons = [];
    const extracted = extractFileLinks(text);
    for (const item of extracted) {
      const isPlan = /plan/i.test(item.fileName) || /plan/i.test(item.label) || /kế hoạch/i.test(item.label);
      const displayTitle = item.label.includes(".") ? item.label : item.fileName;
      const uriKey = this.encodeUriKey(item.fileUri);
      if (!this.deliveredArtifacts.has(item.fileUri)) {
        this.deliveredArtifacts.add(item.fileUri);
        if (isPlan) {
          artifactButtons.push([
            { text: "\u2705 \u0110\u1ED3ng \xFD (Approve)", callback_data: `plan:approve:${uriKey}` },
            { text: "\u274C T\u1EEB ch\u1ED1i (Reject)", callback_data: `plan:reject:${uriKey}` }
          ]);
          artifactButtons.push([
            { text: `\u{1F4C4} Xem t\u1EC7p ${displayTitle}`, callback_data: `view:${uriKey}` }
          ]);
        } else {
          artifactButtons.push([
            { text: `\u{1F4C4} Xem t\u1EC7p ${displayTitle}`, callback_data: `view:${uriKey}` }
          ]);
        }
      }
    }
    const chunks = splitChunks(text);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isLastChunk = i === chunks.length - 1;
      const html = mdToTgHtml(chunk);
      const body = { chat_id: chatId, text: html, parse_mode: "HTML" };
      if (isLastChunk && artifactButtons.length > 0) {
        body.reply_markup = { inline_keyboard: artifactButtons };
      }
      const r = await api(this.opts.token, "sendMessage", body);
      if (!r?.ok) {
        this.opts.log(`[tg] HTML parse failed (${r?.description ?? "unknown error"}), falling back to plain text`);
        const fallbackBody = { chat_id: chatId, text: chunk };
        if (isLastChunk && artifactButtons.length > 0) {
          fallbackBody.reply_markup = { inline_keyboard: artifactButtons };
        }
        await api(this.opts.token, "sendMessage", fallbackBody);
      }
    }
  }
  async updateStatus(chatId, text, forTurnId) {
    if (forTurnId !== void 0 && forTurnId !== this.turnId)
      return;
    if (text === this.lastStatusText && this.statusMsgId)
      return;
    this.lastStatusText = text;
    if (this.statusMsgId) {
      const r2 = await api(this.opts.token, "editMessageText", {
        chat_id: chatId,
        message_id: this.statusMsgId,
        text
      });
      if (r2?.ok)
        return;
      const desc = String(r2?.description ?? "");
      if (/not modified/i.test(desc))
        return;
      this.statusMsgId = null;
    }
    if (forTurnId !== void 0 && forTurnId !== this.turnId)
      return;
    const r = await api(this.opts.token, "sendMessage", {
      chat_id: chatId,
      text
    });
    if (r?.ok)
      this.statusMsgId = r.result.message_id;
  }
  async send(chatId, text, parseMode) {
    for (const chunk of splitChunks(text)) {
      const body = { chat_id: chatId, text: chunk };
      if (parseMode)
        body.parse_mode = parseMode;
      await api(this.opts.token, "sendMessage", body);
    }
  }
  sendPhoto(chatId, data, name) {
    return this.sendMultipart(chatId, "sendPhoto", "photo", data, name);
  }
  sendDocument(chatId, data, name) {
    return this.sendMultipart(chatId, "sendDocument", "document", data, name);
  }
  // Minimal multipart/form-data upload for photos/documents (no dependency).
  sendMultipart(chatId, method, field, data, filename) {
    return new Promise((resolve3) => {
      const boundary = "----arp" + Date.now().toString(16);
      const pre = `--${boundary}\r
Content-Disposition: form-data; name="chat_id"\r
\r
${chatId}\r
--${boundary}\r
Content-Disposition: form-data; name="${field}"; filename="${filename}"\r
Content-Type: application/octet-stream\r
\r
`;
      const post = `\r
--${boundary}--\r
`;
      const payload = Buffer.concat([
        Buffer.from(pre, "utf8"),
        data,
        Buffer.from(post, "utf8")
      ]);
      const req = https2.request(
        {
          host: "api.telegram.org",
          path: `/bot${this.opts.token}/${method}`,
          method: "POST",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": payload.length
          },
          timeout: 65e3
        },
        (res) => {
          res.on("data", () => {
          });
          res.on("end", () => resolve3());
        }
      );
      req.on("error", () => resolve3());
      req.on("timeout", () => {
        req.destroy();
        resolve3();
      });
      req.write(payload);
      req.end();
    });
  }
};
function delay2(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function mdToTgHtml(text) {
  let s = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(
    /```(?:[^\n`]*)\n?([\s\S]*?)```/g,
    (_, code) => `<pre><code>${code.trim()}</code></pre>`
  );
  s = s.replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, (_, t) => `<b>${t}</b>`);
  s = s.replace(/__([^_\n]+)__/g, (_, t) => `<b>${t}</b>`);
  s = s.replace(/(?<!^\s*)\*([^*\n]+)\*/gm, (_, t) => `<i>${t}</i>`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    if (url.startsWith("file://") || url.startsWith("#")) {
      return `<b>\u{1F4C4} ${label}</b>`;
    }
    return `<a href="${url}">${label}</a>`;
  });
  s = s.replace(/^#{1,6}\s+(.+)$/gm, (_, t) => `<b>${t}</b>`);
  s = s.replace(/^[-*_]{3,}$/gm, "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
  return s;
}
function extractFileLinks(text) {
  const results = [];
  const regex = /\[([^\]]+)\]\((file:\/\/\/[^)]+)\)/gi;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const label = m[1];
    const fileUri = m[2];
    if (fileUri.toLowerCase().endsWith(".md")) {
      const parts = fileUri.split(/[\\/]/);
      const fileName = parts[parts.length - 1] || "file.md";
      results.push({ label, fileUri, fileName });
    }
  }
  return results;
}
function assistantKey(text) {
  if (text.length <= 300)
    return text;
  return `${text.length}:${text.slice(0, 150)}:${text.slice(-150)}`;
}

// src/extension.ts
var CFG2 = "antigravityRemotePlus";
var output;
var statusBar;
var ls = null;
var chat = null;
var server = null;
var telegram = null;
var running = false;
function log(msg) {
  const line = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${msg}`;
  output?.appendLine(line);
}
function cfg(key, fallback) {
  return vscode5.workspace.getConfiguration(CFG2).get(key, fallback);
}
function lanIps() {
  const nets = os4.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] ?? []) {
      if (ni.family === "IPv4" && !ni.internal)
        ips.push(ni.address);
    }
  }
  return ips;
}
async function startAll(context) {
  if (running) {
    vscode5.window.showInformationMessage("Antigravity Remote Plus already running.");
    return;
  }
  const port = cfg("port", 7377);
  const host = cfg("bindHost", "0.0.0.0");
  const password = cfg("password", "Maiyeu3m");
  if (host === "0.0.0.0" && !password) {
    vscode5.window.showErrorMessage(
      "Refusing to bind to 0.0.0.0 without a password. Set antigravityRemotePlus.password."
    );
    return;
  }
  ls = new LsClient(log);
  chat = new ChatController(ls, log);
  chat.start();
  await chat.resolveActiveCascadeId();
  const debugPort = cfg("remoteDebugPort", 9222);
  const cdpOk = await chat.connectCdp(debugPort);
  if (!cdpOk) {
    log(
      "[ext] CDP not attached \u2014 IDE not started with --remote-debugging-port. Run 'Antigravity Remote Plus: Relaunch IDE with Remote Debug' to enable IDE\u21C4web sync."
    );
  }
  const webRoot = path6.join(context.extensionPath, "media", "web");
  server = new RemoteServer(
    {
      port,
      host,
      password,
      webRoot,
      log,
      // When settings change via the web UI, restart everything so the new
      // port/password/host/telegram config takes effect immediately.
      onSettingsChanged: () => {
        log("[ext] settings changed via web UI \u2014 restarting\u2026");
        setTimeout(() => {
          stopAll();
          startAll(context).catch(
            (e) => log(`[ext] restart after settings change: ${e}`)
          );
        }, 400);
      }
    },
    chat
  );
  try {
    await server.start();
  } catch (e) {
    vscode5.window.showErrorMessage(
      `Failed to start server on ${host}:${port} \u2014 ${e?.message ?? e}`
    );
    log(`[ext] server start failed: ${e?.message ?? e}`);
    server = null;
    chat.stop();
    running = false;
    updateStatusBar();
    return;
  }
  if (cfg("telegramEnabled", false)) {
    const token = cfg("telegramToken", "");
    const chatId = cfg("telegramChatId", "");
    if (token) {
      telegram = new TelegramBridge({ token, chatId, log }, chat);
      await telegram.start();
    } else {
      log("[ext] telegram enabled but no token set");
    }
  }
  running = true;
  updateStatusBar();
  const activePort = server.activePort;
  if (activePort !== port) {
    log(`[ext] requested port ${port} was busy; bound to ${activePort} instead`);
  }
  const lan = host === "0.0.0.0" ? lanIps() : [];
  const urls = [
    `http://127.0.0.1:${activePort}`,
    ...lan.map((ip) => `http://${ip}:${activePort}`)
  ];
  log(`[ext] started. URLs: ${urls.join(", ")}`);
  const primary = lan.length > 0 ? `http://${lan[0]}:${activePort}` : urls[0];
  const msg = lan.length > 0 ? `Antigravity Remote Plus on LAN: ${primary}  (password required)` : `Antigravity Remote Plus running on ${primary}`;
  const actions = lan.length > 0 ? ["Open Web UI", "Copy LAN URL"] : ["Open Web UI"];
  vscode5.window.showInformationMessage(msg, ...actions).then((choice) => {
    if (choice === "Open Web UI")
      openWeb();
    else if (choice === "Copy LAN URL") {
      vscode5.env.clipboard.writeText(primary);
      vscode5.window.showInformationMessage(`Copied: ${primary}`);
    }
  });
}
function stopAll() {
  telegram?.stop();
  telegram = null;
  server?.stop();
  server = null;
  chat?.stop();
  chat = null;
  ls = null;
  running = false;
  updateStatusBar();
  log("[ext] stopped");
}
function openWeb() {
  const port = server?.activePort ?? cfg("port", 7377);
  vscode5.env.openExternal(vscode5.Uri.parse(`http://127.0.0.1:${port}`));
}
function showInfo() {
  const port = server?.activePort ?? cfg("port", 7377);
  const host = cfg("bindHost", "0.0.0.0");
  const urls = [
    `http://127.0.0.1:${port}`,
    ...host === "0.0.0.0" ? lanIps().map((ip) => `http://${ip}:${port}`) : []
  ];
  vscode5.window.showInformationMessage(
    `${running ? "Running" : "Stopped"} \u2014 ${urls.join("  ")} (password protected)`
  );
}
function toggle(context) {
  if (running)
    stopAll();
  else
    startAll(context).catch((e) => log(`[ext] toggle start: ${e}`));
}
async function relaunchWithRemoteDebug() {
  const port = cfg("remoteDebugPort", 9222);
  const choice = await vscode5.window.showWarningMessage(
    `This will reload the IDE window with --remote-debugging-port=${port} so the web UI and IDE chat panel stay in sync. Continue?`,
    { modal: true },
    "Relaunch"
  );
  if (choice !== "Relaunch")
    return;
  try {
    const argvPath = path6.join(os4.homedir(), ".antigravity-ide", "argv.json");
    let argv = {};
    if (fs7.existsSync(argvPath)) {
      const raw = fs7.readFileSync(argvPath, "utf8").replace(/^﻿/, "");
      const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
      try {
        argv = JSON.parse(stripped);
      } catch {
        argv = {};
      }
    }
    argv["remote-debugging-port"] = port;
    fs7.writeFileSync(argvPath, JSON.stringify(argv, null, 2), "utf8");
    log(`[ext] wrote remote-debugging-port=${port} to ${argvPath}`);
  } catch (e) {
    log(`[ext] failed to update argv.json: ${e?.message ?? e}`);
    vscode5.window.showErrorMessage(
      `Couldn't update argv.json automatically: ${e?.message ?? e}`
    );
    return;
  }
  await vscode5.commands.executeCommand("workbench.action.reloadWindow");
}
function updateStatusBar() {
  if (!statusBar)
    return;
  const sync = running && chat?.cdpConnected() ? " $(link)" : "";
  statusBar.text = running ? `$(radio-tower) Remote+${sync}` : "$(circle-slash) Remote+";
  statusBar.tooltip = running ? `Antigravity Remote Plus: running${chat?.cdpConnected() ? ` (IDE\u21C4web synced on CDP port ${chat.cdpPort()})` : " (CDP not attached \u2014 command fallback)"}
Click to stop.` : "Antigravity Remote Plus: stopped \u2014 click to start";
  statusBar.command = "antigravityRemotePlus.toggle";
  statusBar.show();
}
async function activate(context) {
  output = vscode5.window.createOutputChannel("Antigravity Remote Plus");
  context.subscriptions.push(output);
  statusBar = vscode5.window.createStatusBarItem(
    vscode5.StatusBarAlignment.Right,
    100
  );
  context.subscriptions.push(statusBar);
  updateStatusBar();
  context.subscriptions.push(
    vscode5.commands.registerCommand(
      "antigravityRemotePlus.start",
      () => startAll(context)
    ),
    vscode5.commands.registerCommand("antigravityRemotePlus.stop", () => stopAll()),
    vscode5.commands.registerCommand(
      "antigravityRemotePlus.toggle",
      () => toggle(context)
    ),
    vscode5.commands.registerCommand("antigravityRemotePlus.openWeb", openWeb),
    vscode5.commands.registerCommand("antigravityRemotePlus.showInfo", showInfo),
    vscode5.commands.registerCommand(
      "antigravityRemotePlus.relaunchWithRemoteDebug",
      relaunchWithRemoteDebug
    )
  );
  if (cfg("autoStart", true)) {
    setTimeout(() => startAll(context).catch((e) => log(`[ext] autostart: ${e}`)), 2500);
  }
}
function deactivate() {
  stopAll();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
