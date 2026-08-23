// jsdom (CRA's default Jest test environment) doesn't expose TextEncoder/
// TextDecoder as globals, but react-router-dom v7 requires them at import
// time - polyfill from Node's built-in util module before anything else runs.
import { TextEncoder, TextDecoder } from "util";
if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === "undefined") {
  global.TextDecoder = TextDecoder;
}

// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// jsdom has no browser APIs for object URLs/canvas/workers, but maplibre-gl
// calls URL.createObjectURL at module-load time (setting up its worker),
// so any component tree that imports it fails to even load under Jest
// without this stub. Test-environment only - no effect on production code.
if (typeof window.URL.createObjectURL !== "function") {
  window.URL.createObjectURL = () => "blob:mock-url";
}
if (typeof window.URL.revokeObjectURL !== "function") {
  window.URL.revokeObjectURL = () => {};
}

// jsdom doesn't implement scrollIntoView either - components across the app
// call it on mount/update refs (e.g. auto-scrolling a message list).
if (typeof window.Element.prototype.scrollIntoView !== "function") {
  window.Element.prototype.scrollIntoView = () => {};
}
