import { describe, it, expect, vi } from "vitest";
import { createSerialInputHandler } from "../src/serialinput";

function make(mode: "normal" | "echo" | "line") {
  const sent: string[] = [];
  const echoed: string[] = [];
  const handler = createSerialInputHandler(mode, d => sent.push(d), d => echoed.push(d));
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
});
