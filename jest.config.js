module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  watchman: false,
  transform: {
    "^.+\\.(t|j)s$": "ts-jest",
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/main.ts",
    "!src/**/*.entity.ts",
    "!src/**/*.module.ts",
    "!src/**/*.dto.ts",
    "!src/**/*.dto/**",
    "!src/migrations/**",
  ],
  // Ratchet: start just below current measured baseline (2026-06-27: 40% lines,
  // 23% functions, 23% branches). Raise these numbers as more specs are added —
  // never lower them. The goal is 80% lines / 75% functions / 65% branches.
  coverageThreshold: {
    global: {
      lines: 39,
      functions: 22,
      branches: 22,
    },
  },
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
};
