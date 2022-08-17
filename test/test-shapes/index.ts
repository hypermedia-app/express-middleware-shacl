import { DatasetCore } from 'rdf-js'
import { resolve } from 'path'
import { fromFile } from 'rdf-utils-fs'
import $rdf from 'rdf-ext'

export function testShape(shape: string): Promise<DatasetCore> {
  return $rdf.dataset().import(fromFile(resolve(__dirname, `${shape}.ttl`)))
}
