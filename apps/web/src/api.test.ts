// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { formatQueryError } from "./api";

describe("formatQueryError", () => {
  it("reads decoded contract errors", () => {
    expect(
      formatQueryError({
        _tag: "UnauthorizedError",
        error: "invalid username or password",
      }),
    ).toBe("Invalid username or password");
  });

  it("unwraps Effect failure messages carrying serialized contract errors", () => {
    const failure = new Error(
      '{"_tag":"UnauthorizedError","error":"invalid username or password"}',
    );
    expect(formatQueryError(failure)).toBe("Invalid username or password");
    expect(
      formatQueryError(
        '{"_tag":"UnauthorizedError","error":"invalid username or password"}',
      ),
    ).toBe("Invalid username or password");
  });

  it("keeps detail suffixes from backend errors", () => {
    expect(
      formatQueryError({
        _tag: "ForbiddenError",
        error: "not authorized for workspace.list",
        detail: "sign in, or ask an admin",
      }),
    ).toBe("Not authorized for workspace.list: sign in, or ask an admin");
  });

  it("leaves ordinary messages and errors untouched", () => {
    expect(formatQueryError(new Error("network down"))).toBe("network down");
    expect(formatQueryError("timeout")).toBe("timeout");
    expect(formatQueryError(null)).toBeNull();
  });
});
