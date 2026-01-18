import test, { describe } from "node:test";
import assert from "node:assert";
import { resampleHourlyClose } from "../../helpers.ts";

const HOUR_MS = 60 * 60 * 1000;

describe("resampleHourlyClose", () => {
  test("returns empty array for empty input", () => {
    assert.deepStrictEqual(resampleHourlyClose([]), []);
  });

  test("returns single point at bucket start", () => {
    const baseHour = HOUR_MS * 100; // some hour boundary
    const input = [{ date: baseHour + 30 * 60 * 1000, price: 100n }]; // 30 min into hour

    const result = resampleHourlyClose(input);

    assert.deepStrictEqual(result, [{ date: baseHour, price: 100n }]);
  });

  test("takes last price when multiple points in same hour", () => {
    const baseHour = HOUR_MS * 100;
    const input = [
      { date: baseHour + 10 * 60 * 1000, price: 100n }, // 10 min
      { date: baseHour + 20 * 60 * 1000, price: 200n }, // 20 min
      { date: baseHour + 50 * 60 * 1000, price: 300n }, // 50 min (last in hour)
    ];

    const result = resampleHourlyClose(input);

    assert.deepStrictEqual(result, [{ date: baseHour, price: 300n }]);
  });

  test("fills missing hours with LOCF (last observation carried forward)", () => {
    const hour0 = HOUR_MS * 100;
    const hour1 = hour0 + HOUR_MS;
    const hour2 = hour0 + HOUR_MS * 2;
    const hour3 = hour0 + HOUR_MS * 3;

    const input = [
      { date: hour0 + 30 * 60 * 1000, price: 100n }, // hour 0
      // hour 1 missing - should be filled with 100n
      // hour 2 missing - should be filled with 100n
      { date: hour3 + 15 * 60 * 1000, price: 400n }, // hour 3
    ];

    const result = resampleHourlyClose(input);

    assert.deepStrictEqual(result, [
      { date: hour0, price: 100n },
      { date: hour1, price: 100n }, // LOCF
      { date: hour2, price: 100n }, // LOCF
      { date: hour3, price: 400n },
    ]);
  });

  test("handles unsorted input by sorting first", () => {
    const hour0 = HOUR_MS * 100;
    const hour1 = hour0 + HOUR_MS;

    const input = [
      { date: hour1 + 30 * 60 * 1000, price: 200n }, // later point first
      { date: hour0 + 15 * 60 * 1000, price: 100n }, // earlier point second
    ];

    const result = resampleHourlyClose(input);

    assert.deepStrictEqual(result, [
      { date: hour0, price: 100n },
      { date: hour1, price: 200n },
    ]);
  });

  test("works with custom resample interval", () => {
    const THIRTY_MIN = 30 * 60 * 1000;
    const base = THIRTY_MIN * 100;

    const input = [
      { date: base + 10 * 60 * 1000, price: 100n }, // 10 min into bucket 0
      { date: base + THIRTY_MIN + 5 * 60 * 1000, price: 200n }, // bucket 1
    ];

    const result = resampleHourlyClose(input, THIRTY_MIN);

    assert.deepStrictEqual(result, [
      { date: base, price: 100n },
      { date: base + THIRTY_MIN, price: 200n },
    ]);
  });

  test("handles consecutive hours with data", () => {
    const hour0 = HOUR_MS * 100;
    const hour1 = hour0 + HOUR_MS;
    const hour2 = hour0 + HOUR_MS * 2;

    const input = [
      { date: hour0 + 45 * 60 * 1000, price: 100n },
      { date: hour1 + 30 * 60 * 1000, price: 150n },
      { date: hour2 + 15 * 60 * 1000, price: 200n },
    ];

    const result = resampleHourlyClose(input);

    assert.deepStrictEqual(result, [
      { date: hour0, price: 100n },
      { date: hour1, price: 150n },
      { date: hour2, price: 200n },
    ]);
  });
});
