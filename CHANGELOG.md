# express-middleware-shacl

## 1.3.1

### Patch Changes

- 2a6e1e5: When a property with `sh:class` was processed, the middleware would inadvertently modify the resource graph. Those changes would stay for the remainder of the request

## 1.3.0

### Minor Changes

- 8a2645b: Forward `res` to middleware's callbacks

## 1.2.0

### Minor Changes

- aae8333: Pass `Request` object to `loadTypes`

### Patch Changes

- 51ddd31: Update express-rdf-request to 1.1.2
- dc06cb1: Update express to 4.17.3

## 1.1.5

### Patch Changes

- d977c81: fix: [DEP0128] DeprecationWarning: Invalid 'main' field

## 1.1.4

### Patch Changes

- 9997829: Wrong links in package.json

## 1.1.3

### Patch Changes

- 5994f6e: Hydra error context is set to HTTPS by default, with override possible

## 1.1.2

### Patch Changes

- 9e2cd7a: Update clownface-shacl-path

## 1.1.1

### Patch Changes

- 2df50f3: Update RDF/JS types and @tpluscode/rdf-ns-builders

## 1.1.0

### Minor Changes

- fe3f56e: Correctly validate against hierarchies of shapes

## 1.0.1

### Patch Changes

- 9184b99: Implicit target shapes were not correctly recognized

## 1.0.0

### Major Changes

- 27e3593: First version
