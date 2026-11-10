// Only errors deliberately constructed by product code may provide UI copy.
// Language, Error.name, statusCode and native error text do not establish trust.
export class PublicError extends Error {}
export function publicErrorMessage(error: unknown) {
  return error instanceof PublicError &&
    error.message.length > 0 &&
    error.message.length < 240 &&
    !/[\n\r]|https?:|Bearer|(?:api[_-]?key|token|password)\s*[:=]/i.test(
      error.message,
    )
    ? error.message
    : "操作失败，请检查请求或服务端配置";
}
