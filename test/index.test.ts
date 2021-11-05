import { describe, it } from 'mocha'
import { expect } from 'chai'
import express, { Express } from 'express'
import request from 'supertest'
import { foaf, rdf, rdfs, schema, sh } from '@tpluscode/rdf-ns-builders'
import clownface from 'clownface'
import $rdf from 'rdf-ext'
import { turtle } from '@tpluscode/rdf-string'
import httpStatus from 'http-status'
import sinon from 'sinon'
import { fromPointer as nodeShape } from '@rdfine/shacl/lib/NodeShape'
import { fromPointer as propertyShape } from '@rdfine/shacl/lib/PropertyShape'
import { shaclMiddleware } from '..'

describe('express-middleware-shacl', () => {
  let app: Express

  beforeEach(() => {
    app = express()
  })

  afterEach(() => {
    sinon.restore()
  })

  it('does nothing if no shapes are loaded', async () => {
    // given
    app.use(shaclMiddleware({
      async loadShapes() {
        return $rdf.dataset()
      },
    }))
    app.use((req, res) => res.end())

    // when
    const response = request(app)
      .post('/foo/bar/baz')
      .send(turtle`<http://example.com/foo/bar/baz> a ${schema.Person} .`.toString())
      .set('host', 'example.com')
      .set('content-type', 'text/turtle')

    // then
    await response.expect(httpStatus.OK)
  })

  it('loads empty resource if it would not be parsed', async () => {
    // given
    app.use(shaclMiddleware({
      async loadShapes() {
        return $rdf.dataset()
      },
    }))
    app.use((req, res) => res.send({ quads: req.shacl.dataGraph.dataset.size }))

    // when
    const response = request(app)
      .post('/foo/bar/baz')
      .send(turtle`<http://example.com/foo/bar/baz> a ${schema.Person} .`.toString())
      .set('host', 'example.com')

    // then
    await response.expect({
      quads: 0,
    })
  })

  it('loads parsed resource into data graph', async () => {
    // given
    app.use(shaclMiddleware({
      async loadShapes() {
        return $rdf.dataset()
      },
    }))
    app.use((req, res) => res.send(req.shacl.dataGraph.out(rdf.type).values))

    // when
    const response = request(app)
      .post('/foo/bar/baz')
      .send(turtle`<http://example.com/foo/bar/baz> a ${schema.Person} .`.toString())
      .set('host', 'example.com')
      .set('content-type', 'text/turtle')

    // then
    await response.expect([
      schema.Person.value,
    ])
  })

  it('responds Problem Document if no loaded shape targets any resources in data graph', async () => {
    // given
    app.use(shaclMiddleware({
      async loadShapes() {
        const pointer = clownface({ dataset: $rdf.dataset() }).blankNode()
        nodeShape(pointer, {
          targetClass: [schema.Article],
        })

        return pointer.dataset
      },
    }))

    // when
    const response = request(app)
      .post('/foo/bar/baz')
      .send(turtle`<http://example.com/foo/bar/baz> a ${schema.Person} .`.toString())
      .set('host', 'example.com')
      .set('content-type', 'text/turtle')

    // then
    await response.expect(400)
      .expect(res => {
        expect(res.body.detail).to.eq('No target resources found for loaded shapes')
      })
  })

  it('responds Problem Document if validation fails', async () => {
    // given
    app.use(shaclMiddleware({
      async loadShapes() {
        const graph = clownface({ dataset: $rdf.dataset() })
        nodeShape(graph.blankNode(), {
          targetClass: [schema.Person],
          property: propertyShape(graph.blankNode(), {
            path: schema.name,
            minCount: 1,
          }),
        })

        return graph.dataset
      },
    }))

    // when
    const response = request(app)
      .post('/foo/bar/baz')
      .send(turtle`<http://example.com/foo/bar/baz> a ${schema.Person} .`.toString())
      .set('host', 'example.com')
      .set('content-type', 'text/turtle')

    // then
    await response.expect(400)
      .expect('link', /https:\/\/www\.w3\.org\/ns\/hydra\/error/)
      .expect(res => {
        expect(res.body.detail).to.eq('The request payload does not conform to the SHACL description of this endpoint.')
      })
  })

  it('calls next middleware when validation succeeds by class target', async () => {
    // given
    app.use(shaclMiddleware({
      async loadShapes() {
        const graph = clownface({ dataset: $rdf.dataset() })
        nodeShape(graph.blankNode(), {
          targetClass: [schema.Person],
          property: propertyShape(graph.blankNode(), {
            path: schema.name,
            minCount: 1,
          }),
        })

        return graph.dataset
      },
    }))
    app.use((req, res) => res.end())

    // when
    const response = request(app)
      .post('/foo/bar/baz')
      .send(turtle`<http://example.com/foo/bar/baz> a ${schema.Person} ; ${schema.name} "John Doe" .`.toString())
      .set('host', 'example.com')
      .set('content-type', 'text/turtle')

    // then
    await response.expect(200)
  })

  it('calls next middleware when validation succeeds by implicit class target', async () => {
    // given
    app.use(shaclMiddleware({
      async loadShapes() {
        const graph = clownface({ dataset: $rdf.dataset() })
        nodeShape(graph.namedNode(schema.Person), {
          types: [rdfs.Class, sh.NodeShape],
          property: propertyShape(graph.blankNode(), {
            path: schema.name,
            minCount: 1,
          }),
        })

        return graph.dataset
      },
    }))
    app.use((req, res) => res.end())

    // when
    const response = request(app)
      .post('/foo/bar/baz')
      .send(turtle`<http://example.com/foo/bar/baz> a ${schema.Person} ; ${schema.name} "John Doe" .`.toString())
      .set('host', 'example.com')
      .set('content-type', 'text/turtle')

    // then
    await response.expect(200)
  })

  it('returns Problem Document if loaded shape has no target and is not rdfs:Class', async () => {
    // given
    app.use(shaclMiddleware({
      async loadShapes() {
        const graph = clownface({ dataset: $rdf.dataset() })
        nodeShape(graph.namedNode(schema.Person), {
          types: [sh.NodeShape],
          property: propertyShape(graph.blankNode(), {
            path: schema.name,
            minCount: 1,
          }),
        })

        return graph.dataset
      },
    }))
    app.use((req, res) => res.end())

    // when
    const response = request(app)
      .post('/foo/bar/baz')
      .send(turtle`<http://example.com/foo/bar/baz> a ${schema.Person} ; ${schema.name} "John Doe" .`.toString())
      .set('host', 'example.com')
      .set('content-type', 'text/turtle')

    // then
    await response.expect(400).expect('link', /https:\/\/www\.w3\.org\/ns\/hydra\/error/)
  })

  it('calls next middleware when validation succeeds by node target', async () => {
    // given
    app.use(shaclMiddleware({
      async loadShapes() {
        const graph = clownface({ dataset: $rdf.dataset() })
        nodeShape(graph.blankNode(), {
          targetNode: [$rdf.namedNode('http://example.com/foo/bar/baz')],
          property: propertyShape(graph.blankNode(), {
            path: schema.name,
            minCount: 1,
          }),
        })

        return graph.dataset
      },
    }))
    app.use((req, res) => res.end())

    // when
    const response = request(app)
      .post('/foo/bar/baz')
      .send(turtle`<http://example.com/foo/bar/baz> ${schema.name} "John Doe" .`.toString())
      .set('host', 'example.com')
      .set('content-type', 'text/turtle')

    // then
    await response.expect(200)
  })

  it('calls next middleware when validation succeeds by "subject of" target', async () => {
    // given
    app.use(shaclMiddleware({
      async loadShapes() {
        const graph = clownface({ dataset: $rdf.dataset() })
        nodeShape(graph.blankNode(), {
          targetSubjectsOf: schema.name,
          property: propertyShape(graph.blankNode(), {
            path: schema.name,
            minCount: 1,
          }),
        })

        return graph.dataset
      },
    }))
    app.use((req, res) => res.end())

    // when
    const response = request(app)
      .post('/foo/bar/baz')
      .send(turtle`<http://example.com/foo/bar/baz> ${schema.name} "John Doe" .`.toString())
      .set('host', 'example.com')
      .set('content-type', 'text/turtle')

    // then
    await response.expect(200)
  })

  it('passes validation using sh:class by loading external types', async () => {
    // given
    app.use(shaclMiddleware({
      async loadShapes() {
        const graph = clownface({ dataset: $rdf.dataset() })
        nodeShape(graph.blankNode(), {
          targetClass: [schema.Person],
          property: propertyShape(graph.blankNode(), {
            path: schema.spouse,
            class: schema.Person,
          }),
        })

        return graph.dataset
      },
      async loadTypes(resources) {
        return $rdf.dataset(resources.map(resource => $rdf.quad(resource, rdf.type, schema.Person)))
      },
    }))
    app.use((req, res) => res.end())

    // when
    const response = request(app)
      .post('/Leonard')
      .send(turtle`<Leonard> a ${schema.Person} ; ${schema.spouse} <Penny> .`.toString({ base: 'http://example.com/' }))
      .set('host', 'example.com')
      .set('content-type', 'text/turtle')

    // then
    await response.expect(200)
  })

  it('validates resource using hierarchy of shapes', async () => {
    // given
    app.use(shaclMiddleware({
      async loadShapes() {
        return clownface({ dataset: $rdf.dataset() }).node(foaf.Person)
          .addOut(rdfs.subClassOf, foaf.Agent)
          .addOut(rdf.type, [rdfs.Class, sh.NodeShape])
          .node(foaf.Agent)
          .addOut(rdf.type, [rdfs.Class, sh.NodeShape])
          .addOut(sh.property, property => {
            property
              .addOut(sh.path, foaf.name)
              .addOut(sh.minCount, 1)
          }).dataset
      },
      async loadTypes(resources) {
        return $rdf.dataset(resources.map(resource => $rdf.quad(resource, rdf.type, foaf.Person)))
      },
    }))
    app.use((req, res) => res.end())

    // when
    const response = request(app)
      .post('/Leonard')
      .send(turtle`<> a ${foaf.Person} .`.toString())
      .set('host', 'example.com')
      .set('content-type', 'text/turtle')

    // then
    await response.expect(400)
      .expect(res => {
        expect(res.text).to.contain('MinCount')
      })
  })
})
