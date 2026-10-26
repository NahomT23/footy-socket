/**
 * jsdom setup for component suites.
 *
 * Opt in per file with:
 *   @vitest-environment jsdom
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
