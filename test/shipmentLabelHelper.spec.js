jest.mock('path')
jest.mock('os')
jest.mock('pdf-merger-js')

import {mergePDF} from '../src/mergePDF'
import path from 'path'
import os from 'os'
import PDFMerger from 'pdf-merger-js'

describe('mergePDF', () => {
    
    beforeEach(() => {
      path.join.mockImplementation((...params) => {
        return params.join('/')
      })  
      os.tmpdir.mockImplementation((...params) => {
        return ''
      })  
      PDFMerger.mockClear()
    })
  
    it('files without pdf', async () => {
      const localFiles = [{name: 'file1.csv', path:'/local/temp/file1.csv'}]
      const localBase = 'local'

      const rtn = await mergePDF(localFiles, localBase)
      expect(rtn).toEqual([
        {
          name: 'file1.csv', 
          path:'/local/temp/file1.csv'
        },
        {
          name: 'label.pdf',
          path: '/local/label.pdf',
        }
      ])
    })

    it('files with more than one pdfs', async () => {
      const localFiles = [
        {name: 'file1.pdf', path:'/local/temp/file1.pdf'},
        {name: 'file2.pdf', path:'/local/temp/file2.pdf'},
        {name: 'file3.pdf', path:'/local/temp/file3.pdf'}
      ]
      const localBase = 'local'

      const rtn = await mergePDF(localFiles, localBase)
      const PDFMergerInstance = PDFMerger.mock.instances[0]
      expect(rtn).toEqual([
        {
          name: 'label.pdf',
          path: '/local/label.pdf',
        }
      ])
      expect(PDFMergerInstance.add).toHaveBeenCalledTimes(3)
      expect(PDFMergerInstance.add.mock.calls[0][0]).toEqual('/local/file1.pdf')
      expect(PDFMergerInstance.add.mock.calls[1][0]).toEqual('/local/file2.pdf')
      expect(PDFMergerInstance.add.mock.calls[2][0]).toEqual('/local/file3.pdf')
    })
  })