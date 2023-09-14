import { DatasetCore } from 'rdf-js'
import { resolve } from 'path'
import * as url from 'url'
import { fromFile } from 'rdf-utils-fs'
import $rdf from '@zazuko/env'
import fromStream from 'rdf-dataset-ext/fromStream.js'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

export function testShape(shape: string): Promise<DatasetCore> {
  return fromStream($rdf.dataset(), fromFile(resolve(__dirname, `${shape}.ttl`)))
}
