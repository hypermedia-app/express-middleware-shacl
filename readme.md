# express-middleware-shacl

Express middleware which validates request bodies using SHACL Shapes

Uses [rdf-validate-shacl](https://npm.im/rdf-validate-shacl) to create the validation report.

If validation fails, returns an [RFC 7807](https://tools.ietf.org/html/rfc7807) Problem Details
document extended to be valid JSON-LD resource.

## Setup

The package export a factory to create an express middleware handler. One parameter is required:

```typescript
import express from 'express'
import { shaclMiddleware } from 'express-middleware-shacl'
import { rdf } from '@tpluscode/rdf-ns-builders'
import { NamedNode, Quad } from 'rdf-js' 
import { GraphPointer } from 'clownface'
import { loadResource } from './store'

const app = express()

app.use(shaclMiddleware({
  // Load the shapes to populate the Shapes Graph.
  async loadShapes(req): Promise<GraphPointer[]> {
      // Should at least use the payload resource types but might also select more shapes,
      // such as any shape annotated on the existing resource in database
      const types = req.shacl.dataGraph.out(rdf.type).terms
      
      return Promise.all(types.map(loadResource))
  },
  // (Optional) Load rdf:type quads of the given resources
  loadTypes(resources: NamedNode[]): Promise<Quad[]> {
      // For example, could be implemented as a SPARQL query
      /*
       CONSTRUCT { ?resource a ?type }
       WHERE { ?resource a ?type }
       */
  }
}))
```

## Details

The middleware works in four stages. Check the sections below for more explanations

1. Create `req.shacl` structure on `Request` object
2. Load SHACL Shapes needed to validate
3. Load instance types, if necessary
4. Run validation

### `req.shacl`

Downstream handler will have access to `req.shacl`, which is defined as 

```typescript
import type { NamedNode } from 'rdf-js'
import type { GraphPointer } from 'clownface'
import type DatasetExt from 'rdf-ext/lib/Dataset' 

interface Shacl {
    /**
     * The requested RDF resource, parsed from body
     */
    dataGraph: GraphPointer
    
    /**
     * RDF/JS dataset for the loaded Shapes
     */
    shapesGraph: DatasetExt
}
```

By default, [express-rdf-resource](https://npm.im/express-rdf-resource) will be used to parse the
incoming request. This can be changed by adding a custom middleware before SHACL.

```js
import express from 'express'
import clownface from 'clownface'

const app = express()

app.use((req, res, next) => {
  req.resource = async function() {
    // an async function which should return a Graph Pointer
    let dataset
    let term
    
    return clownface({ dataset, term })
  }
  
  next()
})

app.use(shaclMiddleware({
  // ...
}))
```

### Load instance types

Consider a resource with links to another:

```turtle
prefix schema: <http://schema.org/>
base <http://example.com/>

<Leonard> a <vocab/Person> ;
  schema:spouse <Penny> ;
  schema:knows <Howard>, <Sheldon> ;
.
```

The type `<vocab/Person>` may be a shape which requires the object of `schema:spouse` and
`schema:knows` to also be an instance of the same type:

```turtle
prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>
prefix sh: <http://www.w3.org/ns/shacl#>
prefix schema: <http://schema.org/>
base <http://example.com/>

<vocab/Person>
  a rdfs:Class, sh:NodeShape ;
  sh:property [
    sh:path schema:spouse ;
    sh:class <vocab/Person> ;
  ] , [
    sh:path schema:knows ;
    sh:class <vocab/Person> ;
  ] ;
.
```

As-is, validation of the resource `<Leonard>` will fail because a SHACL validation library will not
be able to verify that the linked resources also have the correct RDF type.

Given such shapes, it will be necessary to provide an implementation of the `loadTypes` option. As
mentioned above, it could be implemented as SPARQL Construct. In a simplest case, when the store's
default graph would be queried fo all data, that query could be as simple as:

```sparql
base <http://example.com/>

CONSTRUCT { ?instance a ?type }
WHERE {
  VALUES ?instance {
    <Penny> <Howard> <Sheldon>
  }

  ?instance a ?type .
}
```

### Validation run

If the `req.shacl.shapesGraph` dataset is empty, the next middleware will be called.

If the validation succeeds (`sh:conforms true`), the next middleware will be called.
