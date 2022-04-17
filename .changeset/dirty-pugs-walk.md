---
"express-middleware-shacl": patch
---

When a property with `sh:class` was processed, the middleware would inadvertently modify the resource graph. Those changes would stay for the remainder of the request
