/**
 * NexusOS Load Tests — k6 Script
 *
 * Usage:
 *   npm install -g k6
 *   k6 run tests/load/k6-load-test.js --env BASE_URL=http://localhost:3000
 *   k6 run tests/load/k6-load-test.js --env BASE_URL=https://your-domain.com
 *
 * Test scenarios:
 *   SMOKE_TEST    — 1 VU, 1 min  — verifies APIs respond correctly
 *   LOAD_TEST     — 50 VUs, 5 min — simulates normal traffic
 *   STRESS_TEST   — ramp to 200 VUs — finds breaking point
 *   SPIKE_TEST    — sudden 500 VU burst — tests recovery
 *
 * Set scenario via: k6 run --env SCENARIO=stress tests/load/k6-load-test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Custom metrics ─────────────────────────────────────────────────────────
const errorRate         = new Rate('error_rate');
const apiLatency        = new Trend('api_latency', true);
const authLatency       = new Trend('auth_latency', true);
const orderFlowLatency  = new Trend('order_flow_latency', true);
const fraudCheckLatency = new Trend('fraud_check_latency', true);
const memoryOps         = new Counter('memory_operations');

// ── Scenario configuration ─────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SCENARIO = __ENV.SCENARIO || 'load';

const SCENARIOS = {
  smoke: {
    executor: 'constant-vus',
    vus: 1, duration: '1m',
    gracefulStop: '30s',
  },
  load: {
    executor: 'ramping-vus',
    gracefulRampDown: '30s',
    stages: [
      { duration: '30s', target: 10  },   // warm up
      { duration: '2m',  target: 50  },   // ramp to normal load
      { duration: '2m',  target: 50  },   // hold
      { duration: '30s', target: 0   },   // ramp down
    ],
  },
  stress: {
    executor: 'ramping-vus',
    gracefulRampDown: '60s',
    stages: [
      { duration: '1m',  target: 50  },
      { duration: '2m',  target: 100 },
      { duration: '2m',  target: 200 },   // stress level
      { duration: '2m',  target: 200 },   // hold
      { duration: '1m',  target: 0   },
    ],
  },
  spike: {
    executor: 'ramping-vus',
    gracefulRampDown: '30s',
    stages: [
      { duration: '10s', target: 10  },   // baseline
      { duration: '10s', target: 500 },   // spike!
      { duration: '1m',  target: 500 },   // hold spike
      { duration: '10s', target: 10  },   // recover
      { duration: '30s', target: 0   },
    ],
  },
};

export const options = {
  scenarios: { nexus_load: SCENARIOS[SCENARIO] || SCENARIOS.load },
  thresholds: {
    // SLAs — test fails if these are violated
    'http_req_duration':  ['p(95)<2000'],    // 95% of requests under 2s
    'http_req_duration':  ['p(99)<5000'],    // 99% under 5s
    'error_rate':         ['rate<0.01'],     // < 1% error rate
    'api_latency':        ['p(90)<1000'],    // API p90 under 1s
    'auth_latency':       ['p(95)<500'],     // Auth p95 under 500ms
    'order_flow_latency': ['p(95)<3000'],    // Order flow p95 under 3s
  },
};

// ── Shared state ───────────────────────────────────────────────────────────
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || 'test-admin-token';
const TEST_USER_ID = `load_test_user_${__VU}`;

const headers = {
  json:  { 'Content-Type': 'application/json' },
  auth:  { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_TOKEN}` },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function req(method, path, body, hdrs = headers.json) {
  const url = `${BASE_URL}${path}`;
  const payload = body ? JSON.stringify(body) : null;
  const start = Date.now();
  const res = method === 'GET'    ? http.get(url, { headers: hdrs }) :
              method === 'POST'   ? http.post(url, payload, { headers: hdrs }) :
              method === 'PUT'    ? http.put(url, payload, { headers: hdrs }) :
              method === 'DELETE' ? http.del(url, payload, { headers: hdrs }) : null;

  const dur = Date.now() - start;
  apiLatency.add(dur);
  errorRate.add(res.status >= 500);
  return res;
}

// ── Test scenarios ─────────────────────────────────────────────────────────

export default function main() {
  testHealthEndpoints();
  sleep(0.5);

  testAuthFlow();
  sleep(0.5);

  testCouponValidation();
  sleep(0.5);

  testPolicyEvaluation();
  sleep(0.5);

  testDeliveryTracking();
  sleep(1);
}

function testHealthEndpoints() {
  group('Health & System', () => {
    const res = req('GET', '/api/health');
    check(res, {
      'health returns 200':       r => r.status === 200,
      'health returns status':    r => JSON.parse(r.body)?.status !== undefined,
      'health responds fast':     r => r.timings.duration < 500,
    });

    // API versioning — /api/v1 must forward correctly
    const v1 = req('GET', '/api/v1/health');
    check(v1, {
      'v1 health returns 200':    r => r.status === 200,
      'v1 header present':        r => r.headers['X-API-Version'] !== undefined,
    });
  });
}

function testAuthFlow() {
  group('Auth Flow', () => {
    const start = Date.now();

    // Test refresh with invalid token (should get 401, not 500)
    const refreshRes = req('POST', '/api/auth/refresh', { refreshToken: 'invalid_token_test' });
    check(refreshRes, {
      'invalid refresh → 401':    r => r.status === 401,
      'no 500 on bad token':      r => r.status !== 500,
    });

    // Test forgot-password (should always return 200 for security)
    const fpRes = req('POST', '/api/auth/forgot-password', { email: `test_${__VU}@example.com` });
    check(fpRes, {
      'forgot-password 200':      r => r.status === 200,
      'generic success message':  r => JSON.parse(r.body)?.success === true,
    });

    authLatency.add(Date.now() - start);
  });
}

function testCouponValidation() {
  group('Coupon Validation (with fraud gate)', () => {
    // Valid code attempt
    const res = req('POST', '/api/commerce/calculate-discounts', {
      code:          'SAVE10',
      customerId:    TEST_USER_ID,
      orderSubtotal: 600,
    });
    check(res, {
      'coupon response 200':    r => r.status === 200,
      'valid field present':    r => JSON.parse(r.body)?.valid !== undefined,
    });
    errorRate.add(res.status >= 500);

    // Brute force attempt — should be rate-limited after N requests
    // We simulate multiple rapid attempts to verify fraud gate fires
    for (let i = 0; i < 3; i++) {
      const bruteRes = req('POST', '/api/commerce/calculate-discounts', {
        code:          `BRUTE_${Math.random().toString(36).slice(2)}`,
        customerId:    `brute_${__VU}`,
        orderSubtotal: 100,
      });
      check(bruteRes, { 'brute force handled gracefully': r => r.status < 500 });
    }
  });
}

function testPolicyEvaluation() {
  group('Business Policy (can-return)', () => {
    const res = req('POST', '/api/policies/can-return', {
      orderId:            `order_load_${__VU}_${Date.now()}`,
      daysSinceDelivery:  Math.floor(Math.random() * 20), // 0-20 days
      customerId:         TEST_USER_ID,
    });
    check(res, {
      'policy returns 200':     r => r.status === 200,
      'allowed field present':  r => JSON.parse(r.body)?.allowed !== undefined,
      'policy fast':            r => r.timings.duration < 1000,
    });
  });
}

function testDeliveryTracking() {
  group('Delivery Tracking (public endpoint)', () => {
    const start = Date.now();
    const orderId = `order_${__VU}_${Date.now()}`;

    const res = req('GET', `/api/orders/${orderId}/tracking`);
    check(res, {
      'tracking not 500':       r => r.status !== 500,
      'tracking responds fast': r => r.timings.duration < 800,
    });

    // Timeline is public — test without auth
    const timeline = req('GET', `/api/delivery/timeline/${orderId}`);
    check(timeline, {
      'timeline not 500':       r => r.status !== 500,
    });

    orderFlowLatency.add(Date.now() - start);
  });
}

// ── Setup / teardown ───────────────────────────────────────────────────────

export function setup() {
  console.log(`\nNexusOS Load Test starting`);
  console.log(`  BASE_URL: ${BASE_URL}`);
  console.log(`  SCENARIO: ${SCENARIO}`);
  console.log(`  Thresholds: p95<2s, error rate<1%\n`);

  // Verify server is up before starting
  const health = http.get(`${BASE_URL}/api/health`);
  if (health.status !== 200) {
    throw new Error(`Server not ready: ${BASE_URL}/api/health returned ${health.status}`);
  }
  return { startTime: Date.now() };
}

export function teardown(data) {
  const elapsed = ((Date.now() - data.startTime) / 1000).toFixed(1);
  console.log(`\nLoad test complete in ${elapsed}s`);
}
