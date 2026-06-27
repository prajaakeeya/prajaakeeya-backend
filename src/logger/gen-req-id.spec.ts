import "reflect-metadata";
import { genReqId } from "./gen-req-id";

// Minimal IncomingMessage / ServerResponse stubs — only the fields genReqId touches.
function makeReq(xRequestId?: string | string[]): any {
  return {
    headers: xRequestId !== undefined ? { "x-request-id": xRequestId } : {},
  };
}

function makeRes(): any {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }),
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("genReqId()", () => {
  it("passes through a valid X-Request-Id unchanged", () => {
    const req = makeReq("my-correlation-id-123");
    const res = makeRes();

    const id = genReqId(req, res);

    expect(id).toBe("my-correlation-id-123");
    expect(res.headers["X-Request-Id"]).toBe("my-correlation-id-123");
  });

  it("uses the first element when the header is an array", () => {
    const req = makeReq(["first-id", "second-id"]);
    const res = makeRes();

    const id = genReqId(req, res);

    expect(id).toBe("first-id");
  });

  it("generates a UUID when no X-Request-Id header is present", () => {
    const req = makeReq();
    const res = makeRes();

    const id = genReqId(req, res);

    expect(id).toMatch(UUID_RE);
    expect(res.headers["X-Request-Id"]).toMatch(UUID_RE);
  });

  it("generates a UUID when the header is an empty string", () => {
    const req = makeReq("");
    const res = makeRes();

    expect(genReqId(req, res)).toMatch(UUID_RE);
  });

  it("generates a UUID when the header exceeds 128 characters", () => {
    const req = makeReq("a".repeat(129));
    const res = makeRes();

    expect(genReqId(req, res)).toMatch(UUID_RE);
  });

  it("accepts a header of exactly 128 characters", () => {
    const id128 = "x".repeat(128);
    const req = makeReq(id128);
    const res = makeRes();

    expect(genReqId(req, res)).toBe(id128);
  });

  it("generates a UUID when the header contains an ASCII control character (log-injection guard)", () => {
    const req = makeReq("valid-prefix\x0ainjected-log-line");
    const res = makeRes();

    expect(genReqId(req, res)).toMatch(UUID_RE);
  });

  it("generates a UUID when the header contains a null byte", () => {
    const req = makeReq("id\x00poison");
    const res = makeRes();

    expect(genReqId(req, res)).toMatch(UUID_RE);
  });

  it("always sets the X-Request-Id response header", () => {
    const res = makeRes();
    genReqId(makeReq(), res);

    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Request-Id",
      expect.any(String),
    );
  });

  it("two calls with no header produce distinct UUIDs", () => {
    const id1 = genReqId(makeReq(), makeRes());
    const id2 = genReqId(makeReq(), makeRes());

    expect(id1).not.toBe(id2);
  });
});
