import { DatasetCore, NamedNode, Term } from 'rdf-js'
import express, { Request, Router } from 'express'
import asyncMiddleware from 'middleware-async'
import $rdf from 'rdf-ext'
import DatasetExt from 'rdf-ext/lib/Dataset'
import SHACLValidator from 'rdf-validate-shacl'
import clownface, { AnyContext, AnyPointer } from 'clownface'
import { ProblemDocument } from 'http-problem-details'
import { hydra, rdf, sh } from '@tpluscode/rdf-ns-builders'
import { attach } from 'express-rdf-request'
import * as absoluteUrl from 'absolute-url'
import { fromPointer } from '@rdfine/shacl/lib/ValidationResult'
import setLink from 'set-link'

// Trick typescript to not compile import() into require()
// eslint-disable-next-line no-new-func
const _esImport = new Function('modulePath', 'return import(modulePath)')

interface ShaclMiddlewareOptions {
  loadTypes?(resources: NamedNode[]): Promise<DatasetCore>
  loadShapes(req: Request): Promise<DatasetCore>
}

declare module 'express-serve-static-core' {
  interface Request {
    shacl: {
      dataGraph: AnyPointer
      shapesGraph: AnyPointer<AnyContext, DatasetExt>
    }
  }
}

function isNamedNode(term: Term): term is NamedNode {
  return term.termType === 'NamedNode'
}

function targetsFound({ shacl: { shapesGraph, dataGraph } }: express.Request): boolean {
  const classTargets = () => shapesGraph.has(sh.targetClass, dataGraph.has(rdf.type).out(rdf.type)).terms
  const nodeTargets = () => shapesGraph.has(sh.targetNode, dataGraph.has([])).terms

  return classTargets().length > 0 ||
  nodeTargets().length > 0
}

export const shaclMiddleware = ({ loadShapes, loadTypes }: ShaclMiddlewareOptions): Router => {
  const router = Router()

  router.use(asyncMiddleware(async function initShaclGraphs(req, res, next) {
    await attach(req, res)
    absoluteUrl.attach(req)

    let dataGraph: AnyPointer
    if (!req.dataset) {
      dataGraph = clownface({ dataset: $rdf.dataset() })
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
    const shapes = await loadShapes(req)

    req.shacl.shapesGraph.dataset.addAll([...shapes])

    next()
  }))

  // Load data from linked instances to be able to validate their type
  router.use(asyncMiddleware(async function loadResourceTypes(req, res, next) {
    const { findNodes } = await _esImport('clownface-shacl-path')

    const linkedInstances = req.shacl.shapesGraph
      .has(sh.property)
      .out(sh.property)
      .has(sh.class)
      .out(sh.path)
      .toArray()
      .flatMap(path => findNodes(req.shacl.dataGraph, path).terms)
      .filter(isNamedNode)

    if (loadTypes && linkedInstances.length) {
      const typeQuads = await loadTypes(linkedInstances)
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
      return res.status(400).send(new ProblemDocument({
        status: 400,
        title: 'Request validation error',
        detail: 'No target resources found for loaded shapes',
        type: 'http://tempuri.org/BadRequest',
      }))
    }

    const validationReport = new SHACLValidator(req.shacl.shapesGraph.dataset).validate(req.shacl.dataGraph.dataset)
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

    res.setLink('http://www.w3.org/ns/hydra/error', 'http://www.w3.org/ns/json-ld#context')
    res.status(400).send(response)
  }))

  return router
}
