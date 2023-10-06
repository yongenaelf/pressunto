import FileActionsMenu from "@/components/file-actions/FileActionsMenu"
import type { FileModalData } from "@/components/file-actions/FileActionsModal"
import FileActionsModal from "@/components/file-actions/FileActionsModal"
import type { TreeItem } from "@/lib/github"
import { buttonCN, iconCN } from "@/lib/styles"
import { XMarkIcon } from "@heroicons/react/20/solid"
import { PhotoIcon } from "@heroicons/react/24/outline"
import { Link, useMatches, useParams } from "@remix-run/react"
import clsx from "clsx"
import { useState } from "react"

type LoaderData = {
  tree: TreeItem[]
  repo: string
  branch: string
}

export default function MediaDetails() {
  const { mid } = useParams()
  const route = useMatches().find((m) => m.id === 'routes/p/$project/media')
  const { tree, repo, branch } = route?.data as LoaderData
  const folders = tree.filter(t => t.type === 'tree')
  const file = tree.find((t) => t.sha === mid)
  const baseURL = `https://raw.githubusercontent.com/${repo}/${branch}/`
  const [modalData, setModalData] = useState<FileModalData | null>(null)

  if (!file) {
    return null
  }

  return (
    <div className="rounded-lg relative my-8 p-4 bg-slate-100 dark:bg-slate-700">
      <Link
        to='..'
        className={clsx('absolute top-1 right-1 p-1', 'bg-slate-100 dark:bg-slate-100/25', buttonCN.common)}
      >
        <XMarkIcon className="w-5 h-5" />
      </Link>
      <figure>
        <img className="block mx-auto" src={`${baseURL}/${file?.path}`} alt={file?.path} />
        <figcaption className="relative pt-3 text-lg text-slate-700 dark:text-slate-100 flex items-center gap-3">
          <PhotoIcon className={clsx('flex-shrink-0', iconCN.big)} />
          <p className="flex-grow">{file.path}</p>
          <FileActionsMenu
            file={file}
            setModalData={setModalData}
            hasGroupTransition={false}
            wrapperCN="relative"
            menuPosition="bottom-full right-0 mb-12"
          />
        </figcaption>
      </figure>
      {modalData && (
        <FileActionsModal folders={folders} modalData={modalData} onClose={() => setModalData(null)} />
      )}
    </div>
  )
}
