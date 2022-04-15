import { DatasetCore, NamedNode, Quad, Term } from 'rdf-js'
import express, { Request, Response, Router } from 'express'
import asyncMiddleware from 'middleware-async'
import $rdf from 'rdf-ext'
import DatasetExt from 'rdf-ext/lib/Dataset'
import SHACLValidator from 'rdf-validate-shacl'
import clownface, { AnyContext, AnyPointer, GraphPointer } from 'clownface'
import { ProblemDocument } from 'http-problem-details'
import { hydra, rdf, rdfs, sh } from '@tpluscode/rdf-ns-builders'
import { attach } from 'express-rdf-request'
import * as absoluteUrl from 'absolute-url'
import { fromPointer } from '@rdfine/shacl/lib/ValidationResult'
import setLink from 'set-link'
import TermSet from '@rdfjs/term-set'
import RdfResource from '@tpluscode/rdfine/RdfResource'
import { ShapeBundle } from '@rdfine/shacl/bundles'
import { findNodes } from 'clownface-shacl-path'

RdfResource.factory.addMixin(...ShapeBundle)

interface ShaclMiddlewareOptions {
  loadTypes?(resources: NamedNode[], req: Request, res: Response): Promise<DatasetCore>
  loadShapes(req: Request, res: Response): Promise<DatasetCore>
  errorContext?: string
}

declare module 'express-serve-static-core' {
  interface Request {
    shacl: {
      dataGraph: GraphPointer
      shapesGraph: AnyPointer<AnyContext, DatasetExt>
    }
  }
}

function isNamedNode(term: Term): term is NamedNode {
  return term.termType === 'NamedNode'
}

function targetsFound({ shacl: { shapesGraph, dataGraph } }: express.Request): boolean {
  const resourceTypes = new TermSet(dataGraph.any().has(rdf.type).out(rdf.type).terms)

  const classTargets = () => shapesGraph.has(sh.targetClass, dataGraph.any().has(rdf.type).out(rdf.type)).terms
  const implicitClassTargets = () => {
    const shapes = shapesGraph.has(rdf.type, sh.NodeShape).has(rdf.type, rdfs.Class)
    return shapes.terms.filter(shape => resourceTypes.has(shape))
  }
  const nodeTargets = () => shapesGraph.has(sh.targetNode, dataGraph.any().in()).terms
  const subjectOfTargets = () =>
    shapesGraph.has(sh.targetSubjectsOf).out(sh.targetSubjectsOf)
      .toArray()
      .flatMap(predicate => [...dataGraph.dataset.match(null, predicate.term)])

  return classTargets().length > 0 ||
    implicitClassTargets().length > 0 ||
    nodeTargets().length > 0 ||
    subjectOfTargets().length > 0
}

function toGraph(uri: string) {
  const graph = $rdf.namedNode(uri)
  return ({ subject, predicate, object }: Quad) => {
    return $rdf.quad(subject, predicate, object, graph)
  }
}

export const shaclMiddleware = ({ loadShapes, loadTypes, errorContext = 'https://www.w3.org/ns/hydra/error' }: ShaclMiddlewareOptions): Router => {
  const router = Router()

  router.use(asyncMiddleware(async function initShaclGraphs(req, res, next) {
    await attach(req, res)
    absoluteUrl.attach(req)

    let dataGraph: GraphPointer
    if (!req.dataset) {
      dataGraph = clownface({ dataset: $rdf.dataset() }).blankNode()
    } else {
      dataGraph = await req.resource()
    }

    req.shacl = {
      dataGraph,
      shapesGraph: clownface({ dataset: $rdf.dataset() }),
    }
    next()
  }))

  router.use(asyncMiddleware(async (req, res, next) => {
    const shapes = await loadShapes(req, res)

    req.shacl.shapesGraph.dataset.addAll([...shapes])

    next()
  }))

  // Load data from linked instances to be able to validate their type
  router.use(asyncMiddleware(async function loadResourceTypes(req, res, next) {
    const linkedInstances = req.shacl.shapesGraph
      .has(sh.property)
      .out(sh.property)
      .has(sh.class)
      .out(sh.path)
      .toArray()
      .flatMap(path => findNodes(req.shacl.dataGraph, path).terms)
      .filter(isNamedNode)

    if (loadTypes && linkedInstances.length) {
      const typeQuads = await loadTypes(linkedInstances, req, res)
      for (const quad of typeQuads) {
        req.shacl.dataGraph.dataset.add(quad)
      }
    }

    next()
  }))

  router.use(asyncMiddleware(async function validateShapes(req, res, next) {
    setLink.attach(res)

    if (req.shacl.shapesGraph.dataset.size === 0) {
      return next()
    }

    if (!targetsFound(req)) {
      res.setLink(errorContext, 'http://www.w3.org/ns/json-ld#context')
      return res.status(400).send(new ProblemDocument({
        status: 400,
        title: 'Request validation error',
        detail: 'No target resources found for loaded shapes',
        type: 'http://tempuri.org/BadRequest',
      }, {
        '@type': hydra.Error.value,
      }))
    }

    const dataset = $rdf.dataset(
      [...req.shacl.shapesGraph.dataset.map(toGraph('urn:graph:shapes')),
        ...[...req.shacl.dataGraph.dataset].map(toGraph('urn:graph:data'))],
    )

    const validationReport = new SHACLValidator(dataset).validate(dataset)
    if (validationReport.conforms) {
      return next()
    }

    const results = validationReport.results.map((r: any) => fromPointer(clownface(r)).toJSON())
    const response = new ProblemDocument({
      status: 400,
      title: 'Request validation error',
      detail: 'The request payload does not conform to the SHACL description of this endpoint.',
      type: 'http://tempuri.org/BadRequest',
    }, {
      '@type': [
        hydra.Error.value,
        sh.ValidationReport.value,
      ],
      [sh.result.value]: results,
    })

    res.setLink(errorContext, 'http://www.w3.org/ns/json-ld#context')
    res.status(400).send(response)
  }))

  return router
}
