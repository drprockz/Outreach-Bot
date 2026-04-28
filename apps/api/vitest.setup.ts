// Test environment defaults — keep this minimal. Production code asserts
// strong values for JWT_SECRET; tests set a deterministic but obviously-fake
// 32-char value so the assertion passes.
process.env.JWT_SECRET ??= 'test-jwt-secret-do-not-use-in-prod-32chars'
process.env.JWT_EXPIRES_IN ??= '1h'
process.env.NODE_ENV ??= 'test'
process.env.REDIS_URL ??= 'redis://localhost:6379'
process.env.DATABASE_URL ??= 'postgresql://radar:radar@localhost:5432/radar_test'
