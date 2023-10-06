import FileActionsMenu from "@/components/file-actions/FileActionsMenu"
import FileActionsModal from "@/components/file-actions/FileActionsModal"
import type { TreeItem} from "@/lib/github"
import { FileMode, deleteFile, getRepoDetails, getRepoFiles, renameFile } from "@/lib/github"
import { getBasename, getDirname } from "@/lib/pathUtils"
import { getProject, getProjectConfig } from "@/lib/projects.server"
import { requireUserSession, setFlashMessage } from "@/lib/session.server"
import { borderColor, buttonCN, iconCN } from "@/lib/styles"
import { uploadImage } from "@/lib/uploadImage"
import useProjectConfig from "@/lib/useProjectConfig"
import { CloudArrowUpIcon, PhotoIcon } from "@heroicons/react/20/solid"
import type { ActionArgs, LoaderArgs, UploadHandlerPart } from "@remix-run/node"
import { json, unstable_composeUploadHandlers, unstable_createMemoryUploadHandler, unstable_parseMultipartFormData } from "@remix-run/node"
import { Form, Link, Outlet, useActionData, useFetcher, useLoaderData } from "@remix-run/react"
import clsx from "clsx"
import isBinaryPath from "is-binary-path"
import type { ChangeEvent } from "react"
import { useEffect, useRef, useState } from "react"

export async function loader({ params, request }: LoaderArgs) {
  const { token } = await requireUserSession(request)
  const project = await getProject(Number(params.project))
  const tree = await getRepoFiles(token, project.repo, project.branch)
  const details = await getRepoDetails(token, project.repo)

  const branch = project.branch || details.default_branch
  const repo = project.repo

  return json({ tree, branch, repo })
}

export async function action({ params, request }: ActionArgs) {
  const { token } = await requireUserSession(request)
  const project = await getProject(Number(params.project))
  const conf = await getProjectConfig(token, project)
  const folder = conf.mediaFolder === '/' ? '' : conf.mediaFolder || ''

  // differiantiate between "file upload" and "file edit / delete" using http method to not affect the reading of form data

  // upload file
  if (request.method.toLowerCase() === 'post') {
    async function githubUploadHandler({ name, contentType, data, filename }: UploadHandlerPart) {
      if (name !== 'file') return
      const file = await uploadImage(token, {
        repo: project.repo,
        branch: project.branch,
        folder,
        file: {
          contentType,
          data,
          filename: filename!,
        }
      })
      return file.content.path
    }
  
    const uploadHandler = unstable_composeUploadHandlers(
      githubUploadHandler,
      unstable_createMemoryUploadHandler(),
    )
  
    const formData = await unstable_parseMultipartFormData(request, uploadHandler)
    const files = formData.getAll('file') as string[]
    const cookie = await setFlashMessage(request, `Pushed commit "upload image ${files} to ${folder || 'root folder'}" successfully`)
    return json({ ok: true }, { headers: { 'Set-Cookie': cookie }})
  }

  // rename file or move to other folder
  if (request.method.toLowerCase() === 'put') {
    const fd = await request.formData()
    const sha = fd.get('sha') as string
    const path = fd.get('path') as string
    const operation = fd.get('operation') as 'move' | 'rename'

    let newPath = ''
    if (operation === 'move') {
      const folder = fd.get('folder') as string
      newPath = `${folder}/${getBasename(path)}`
    }
    if (operation === 'rename') {
      const name = fd.get('name') as string
      newPath = `${getDirname(path)}/${name}`
    }

    const message = `Move file ${path} to ${newPath}`
    await renameFile(token, {
      repo: project.repo,
      branch: project.branch,
      sha,
      path,
      newPath,
      message
    })

    const cookie = await setFlashMessage(request, `Pushed commit "${message}" successfully`)
    return json({ ok: true }, { headers: { 'Set-Cookie': cookie }})
  }

  // delete file
  if (request.method.toLowerCase() === 'delete') {
    const fd = await request.formData()
    const path = fd.get('path') as string

    const message = `Delete file ${path}`
    await deleteFile(token, {
      branch: project.branch,
      repo: project.repo,
      message,
      path,
    })

    const cookie = await setFlashMessage(request, `Pushed commit "${message}" successfully`)
    return json({ ok: true }, { headers: { 'Set-Cookie': cookie }})
  }
}

type ModalData = {
  operation: 'move' | 'rename' | 'delete'
  file: TreeItem
}

export default function Media() {
  const conf = useProjectConfig()
  const mediaFolder = conf.mediaFolder === '/' ? '' : conf.mediaFolder
  const { tree, repo, branch } = useLoaderData<typeof loader>()
  const folders = tree.filter(t => t.type === 'tree')

  const images = tree.filter(t => isBinaryPath(t.path))
  const [previews, setPreviews] = useState([] as FilePreview[])

  const notExistingPreviews = previews
    .filter(p => !images.some(img => img.path.includes(p.name)))
    .map(p => ({
      sha: '',
      path: mediaFolder ? `${mediaFolder}/${p.name}` : p.name,
      type: 'blob' as const,
      mode: FileMode.FILE,
      url: p.url,
    }))

  const allImages = [...images, ...notExistingPreviews]
  const [modalData, setModalData] = useState<ModalData | null>(null)

  const data = useActionData()

  useEffect(() => {
    if (data) {
      setModalData(null)
    }
  }, [data])

  function closeModal() {
    setModalData(null)
  }

  return (
    <div className="p-4 relative">
      {modalData && (
        <FileActionsModal modalData={modalData} onClose={closeModal} folders={folders} />
      )}
      <header className="mb-8">
        <h2 className="font-medium text-4xl text-slate-500 dark:text-slate-300 mt-4 mb-2">
          Media
        </h2>
        <p className="max-w-prose font-medium">
          This page lists all the images in your repository. You can upload new images or move, rename or delete existing images.
        </p>
      </header>
      <ImageUpload mediaFolder={mediaFolder} onChange={setPreviews} />
      <Outlet />
      <ul className="my-8 flex items-start flex-wrap gap-4">
        {allImages.map(f => (
          <ImageCard
            file={f}
            key={f.sha}
            baseURL={`https://raw.githubusercontent.com/${repo}/${branch}`}
            setModalData={setModalData}
          />
        ))}
      </ul>
    </div>
  )
}

function ImageCard({
  baseURL,
  file,
  setModalData
}: {
  baseURL: string
  file: TreeItem
  setModalData: (data: ModalData) => void
}) {
  return (
    <li key={file.sha} className={clsx('group relative rounded-md border w-[250px]', borderColor, { 'opacity-50': !file.sha })}>
      <Link to={`./${file.sha}`} className="block relative">
        <img loading="lazy" className="object-contain py-2 mx-auto w-40 h-40" src={`${baseURL}/${file.path}`} aria-labelledby={file.sha} />
        <div className="p-2 rounded-b-md flex items-center gap-2 bg-slate-100 dark:bg-slate-700">
          <PhotoIcon className={clsx('flex-shrink-0', iconCN.big)} />
          <p id={file.sha} className="text-lg truncate">{getBasename(file.path)}</p>
        </div>
      </Link>
      <FileActionsMenu file={file} setModalData={setModalData} />
    </li>
  )
}

type FilePreview = {
  url: string
  name: string
}

function ImageUpload({
  mediaFolder,
  onChange
}: {
  mediaFolder?: string
  onChange: (previews: FilePreview[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const fetcher = useFetcher()

  async function handleFileChange(ev: ChangeEvent<HTMLInputElement>) {
    fetcher.submit(ev.currentTarget.form, {
      method: 'post',
      encType: 'multipart/form-data',
      replace: true,
    })
    const files = ev.currentTarget.files || []
    const promises = Array.from([...files]).map((file) => {
      return new Promise<FilePreview>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          resolve({
            url: reader.result as string,
            name: file.name,
          })
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
    })
    onChange(await Promise.all(promises))
  }

  return (
    <Form method="post" encType="multipart/form-data">
      <input
        ref={inputRef}
        onChange={handleFileChange}
        multiple
        className="hidden"
        type="file"
        name="file"
        accept="image/*"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={clsx(buttonCN.slate, buttonCN.normal, buttonCN.iconLeft)}
      >
        <CloudArrowUpIcon className='w-5 h-5' />
        <p>Upload new images</p>
      </button>
      <p className="text-slate-500 dark:text-slate-300 text-sm mt-1">
        Images will be uploaded to your media folder <code>{mediaFolder}</code>. You can change this folder in <Link className="underline" to="../settings">project settings</Link>.
      </p>
    </Form>
  )
}
