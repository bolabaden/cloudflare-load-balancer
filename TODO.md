# Cloudflare Worker Loadbalancer TODO List

## ✅ 1. **Round-Robin Algorithm Core**

* [ ] Implement round-robin index tracking (incrementing per request, modulo backend list length).
* [ ] Handle concurrency safely (atomic updates, especially across multiple instances—Durable Object helps here).
* [ ] Support weighted round-robin (optional but useful).

---

## ✅ 2. **Session Stickiness (Affinity)**

* [ ] Support session stickiness via:

  * [ ] Cookies (e.g., `X-Backend-Id`)
  * [ ] IP hashing fallback (e.g., for non-cookie clients like APIs)
* [ ] Allow configuring sticky vs. non-sticky routing per route or domain.

---

## ✅ 3. **Request Proxying**

* [ ] Forward all relevant headers (esp. `Host`, `Authorization`, cookies).
* [ ] Rewrite `Host` header or preserve based on backend type (important for virtual hosting).
* [ ] Handle streaming (chunked requests/responses, WebSockets, SSE).
* [ ] Preserve HTTP methods and bodies (GET/POST/PUT/DELETE/etc.).
* [ ] Normalize and validate URLs to avoid open proxy issues.

---

## ✅ 4. **Resilience & State**

* [ ] Use Durable Object for:

  * [ ] Persisting the backend list and round-robin pointer.
  * [ ] Managing concurrent access to index.
* [ ] Implement fallback strategy for overflow cases (e.g., if all backends are unreachable, but this is borderline devops).

---

## ✅ 5. **Backend List Management**

* [ ] Allow dynamic backend registration/removal (hot updates).
* [ ] Support static configuration fallback.
* [ ] Ensure order is deterministic and consistent across restarts.

---

## ✅ 6. **Consistency Across Multiple Workers**

* [ ] Route traffic for a given domain/path to the same Durable Object (e.g., via `.get(id)` keyed by hostname or route).
* [ ] Ensure Durable Object doesn’t become a bottleneck (use per-route or per-user affinity when needed).

---

## ✅ 7. **Timeouts & Retries (Logical Handling)**

* [ ] Handle upstream timeouts gracefully and retry next backend (configurable max retry count).
* [ ] Avoid retrying non-idempotent methods unless explicitly allowed.
* [ ] Support configurable per-backend timeouts.

---

## ✅ 8. **Observability Support**

* [ ] Expose metadata in response headers for debugging (e.g., `X-Backend-Used`).
* [ ] Optionally log request→backend mappings (ideally via queue or log stream to avoid blocking).

---

## ✅ 9. **Graceful Failover**

* [ ] If selected backend is down/unreachable, skip to the next (and preserve index state).
* [ ] Track temporary backend failures (without health checks) using request failures.
