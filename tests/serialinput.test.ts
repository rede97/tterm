import { describe, it, expect, vi } from "vitest";
import { createSerialInputHandler } from "../src/util/serialinput";

function make(mode: "normal" | "echo" | "line", enter: "cr" | "lf" | "crlf" = "cr") {
  const sent: string[] = [];
  const echoed: string[] = [];
  const handler = createSerialInputHandler(mode, enter, d => sent.push(d), d => echoed.push(d));
  return { sent, echoed, handler };
}

describe("serial input modes", () => {
  it("normal: forwards bytes, no local echo", () => {
    const { sent, echoed, handler } = make("normal");
    handler("abc\r");
    expect(sent.join("")).toBe("abc\r");
    expect(echoed.join("")).toBe("");
  });

  it("echo: forwards and echoes locally", () => {
    const { sent, echoed, handler } = make("echo");
    handler("at\r");
    expect(sent.join("")).toBe("at\r");
    expect(echoed.join("")).toBe("at\r");
  });

  it("line: buffers locally and sends whole line on Enter", () => {
    const { sent, echoed, handler } = make("line");
    handler("ati");
    expect(sent.join("")).toBe("");          // nothing sent yet
    expect(echoed.join("")).toBe("ati");     // local echo while editing
    handler("\r");
    expect(sent.join("")).toBe("ati\r");
    expect(echoed.join("")).toBe("ati\r\n");
  });

  it("line: backspace edits the local buffer", () => {
    const { sent, echoed, handler } = make("line");
    handler("atx");
    handler("\x7f"); // delete 'x'
    handler("\r");
    expect(sent.join("")).toBe("at\r");
    expect(echoed.join("")).toContain("\b \b");
  });

  it("line: backspace on empty buffer is a no-op", () => {
    const { sent, echoed, handler } = make("line");
    handler("\x7f\r");
    expect(sent.join("")).toBe("\r");
    expect(echoed.join("")).toBe("\r\n");
  });

  it("line: Ctrl+C sends immediately and clears the buffer", () => {
    const { sent, handler } = make("line");
    handler("junk");
    handler("\x03");
    expect(sent.join("")).toBe("\x03");
    handler("\r");
    expect(sent.join("")).toBe("\x03\r"); // buffer was cleared
  });

  it("line: buffer resets after each line", () => {
    const { sent, handler } = make("line");
    handler("one\r");
    handler("two\r");
    expect(sent.join("")).toBe("one\rtwo\r");
  });

  // -- enter newline (O2) --

  it("normal + lf: Enter sends LF instead of CR", () => {
    const { sent, handler } = make("normal", "lf");
    handler("at\r");
    expect(sent.join("")).toBe("at\n");
  });

  it("normal + crlf: Enter sends CRLF (AT devices)", () => {
    const { sent, handler } = make("normal", "crlf");
    handler("AT+GMR\r");
    expect(sent.join("")).toBe("AT+GMR\r\n");
  });

  it("normal + crlf: \r inside pasted text is also converted", () => {
    const { sent, handler } = make("normal", "crlf");
    handler("line1\rline2\r");
    expect(sent.join("")).toBe("line1\r\nline2\r\n");
  });

  it("echo + lf: sends LF but echoes original", () => {
    const { sent, echoed, handler } = make("echo", "lf");
    handler("x\r");
    expect(sent.join("")).toBe("x\n");
    expect(echoed.join("")).toBe("x\r");
  });

  it("line + crlf: terminator is CRLF, local echo stays CRLF", () => {
    const { sent, echoed, handler } = make("line", "crlf");
    handler("AT\r");
    expect(sent.join("")).toBe("AT\r\n");
    expect(echoed.join("")).toBe("AT\r\n");
  });
});

describe("pasted newlines (regression)", () => {
  it("line mode: bare \\n in pasted text submits the line", () => {
    const { sent, echoed, handler } = make("line");
    handler("first\nsecond\r");
    expect(sent.join("")).toBe("first\rsecond\r");
    expect(echoed.join("")).toBe("first\r\nsecond\r\n");
  });

  it("line mode: a \\r\\n pair submits once, not twice", () => {
    const { sent, handler } = make("line");
    handler("cmd\r\nnext\r\n");
    expect(sent.join("")).toBe("cmd\rnext\r");
  });

  it("normal + crlf: bare \\n is normalized to CRLF", () => {
    const { sent, handler } = make("normal", "crlf");
    handler("a\nb");
    expect(sent.join("")).toBe("a\r\nb");
  });

  it("normal + crlf: \\r\\n does not double the newline", () => {
    const { sent, handler } = make("normal", "crlf");
    handler("a\r\nb");
    expect(sent.join("")).toBe("a\r\nb");
  });
});
