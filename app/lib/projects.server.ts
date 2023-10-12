import { Redis } from "@upstash/redis"
import type { ParsedFile } from "./github"
import { FileMode, commitAndPush, deleteFile, getFileContent, getRepoFiles, saveFile } from "./github"
import { getBasename, getDirname, isMarkdown } from "./pathUtils"
import matter from 'front-matter'

const db = Redis.fromEnv()

export type Project = {
  id: number
  user: string
  title: string
  repo: string
  branch: string
}

export type ProjectCollection = {
  id: string
  name: string
  route: string
  template: string
}

export type ProjectTemplates = {
  id: string
  name: string
  fields: FieldConfig[]
}

export type FieldConfig = {
  name: string
  field: string
  default: string
  hidden: boolean
}

export type ProjectConfig = {
  mediaFolder?: string
  collections: ProjectCollection[]
  templates: ProjectTemplates[]
}

const NEXT_PROJECT_KEY = 'next_project_id'

export async function getUserProjects(user: string) {
  const ids = await db.smembers(`projects:${user}`)
  if (ids.length === 0) {
    return []
  }

  const projects = await db.mget(...ids.map(id => `project:${id}`)) as Project[]
  return projects.sort((a, b) => a.title.localeCompare(b.title))
}

export async function getProject(id: number) {
  return await db.get(`project:${id}`) as Project
}

export async function getIdForRepo(repo: string) {
  return await db.get(`repo:${repo}`)
}

export async function createProject(project: Omit<Project, 'id'>) {
  const id = await db.incr(NEXT_PROJECT_KEY)
  await Promise.all([
    db.sadd(`projects:${project.user}`, id),
    db.set(`project:${id}`, { ...project, id }),
    db.set(`repo:${project.repo}`, id)
  ])

  return id
}

export async function updateProject(project: Project) {
  return db.set(`project:${project.id}`, project)
}

export async function deleteProject(project: Project) {
  return Promise.all([
    db.srem(`projects:${project.user}`, project.id),
    db.del(`project:${project.id}`),
    db.del(`repo:${project.repo}`)
  ])
}

export const CONFIG_FILE_NAME = 'pressunto.config.json'
export const CONFIG_FILE_TEMPLATE = `{
  "collections": [],
  "templates": []
}
`

export async function createConfigFile(token: string, repo: string, branch: string) {
  const repoTree = await getRepoFiles(token, repo, branch)
  const configFile = repoTree.find((f) => f.path === CONFIG_FILE_NAME)
  if (configFile) {
    return
  }

  await saveFile(token, {
    repo,
    branch,
    path: CONFIG_FILE_NAME,
    content: CONFIG_FILE_TEMPLATE,
    message: '[skip ci] Create config file for Pressunto',
  })
}

export async function updateConfigFile(token: string, project: Project, config: ProjectConfig) {
  const file = await getFileContent(token, {
    file: CONFIG_FILE_NAME,
    repo: project.repo,
    branch: project.branch
  })
  await saveFile(token, {
    sha: file?.sha,
    repo: project.repo,
    branch: project.branch || 'master',
    path: CONFIG_FILE_NAME,
    content: JSON.stringify(config, null, 2),
    message: '[skip ci] Update config file for Pressunto',
  })
}

export async function deleteConfigFile(token: string, { repo, branch }: Project) {
  const file = await getFileContent(token, {
    file: CONFIG_FILE_NAME,
    repo,
    branch,
  })

  if (file) {
    await deleteFile(token, {
      repo,
      branch,
      message: '[skip ci] Delete config file for Pressunto',
      path: CONFIG_FILE_NAME,
    })
  }
}

export async function getProjectConfig(token: string, project: Project) {
  const file = await getFileContent(token, {
    file: CONFIG_FILE_NAME,
    repo: project.repo,
    branch: project.branch
  })

  return JSON.parse(file?.content || CONFIG_FILE_TEMPLATE) as ProjectConfig
}

export type CollectionFile = {
  id: string
  title: string
  path: string
  attributes: Record<string, string | number>
  body: string
}

export function processFileContent(fileContent: Pick<ParsedFile, 'content' | 'sha' | 'path'>) {
  const data = matter<{ title: string; order: number }>(fileContent.content)
  const title = data.attributes.title || getBasename(fileContent.path)
  return {
    id: fileContent.sha,
    title,
    path: fileContent.path,
    attributes: data.attributes,
    body: data.body
  }
}

export async function getCollectionFiles(token: string, project: Project, collection: ProjectCollection) {
  const tree = await getRepoFiles(token, project.repo, project.branch)
  const collectionTree = tree.filter((f) => {
    const inCollection = getDirname(f.path) === collection.route.replace(/^\//, '')
    return inCollection && isMarkdown(f.path)
  })

  const parsedFiles = []
  const contents = await Promise.all(
    collectionTree.map((f) => getFileContent(token, {
      file: f.path,
      repo: project.repo,
      branch: project.branch,
    }))
  )

  for (const f of collectionTree) {
    const fileContent = contents[collectionTree.indexOf(f)]

    if (!fileContent) {
      throw new Response(`Content for file "${f.path}" was not found in github API`, {
        status: 404,
        statusText: 'Not found'
      })
    }

    parsedFiles.push(processFileContent(fileContent))
  }

  parsedFiles.sort((a, b) => a.attributes.order - b.attributes.order)

  return parsedFiles as CollectionFile[]
}

type UpdateOrderParams = {
  repo: string
  branch: string
  collectionRoute: string
  files: CollectionFile[]
}

export async function updateCollectionFileOrder(token: string, payload: UpdateOrderParams) {
  const { repo, branch, collectionRoute, files } = payload
  
  const contents = [] as string[]
  for (const file of files) {
    const matter = Object.entries(file.attributes)
      .map(([key, value]) => `${key}: ${key === 'order' ? files.indexOf(file) : value}`)
      .join('\n')

    const content = ['---', matter, '---', '', file.body].join('\n')
    contents.push(content)
  }

  const commit = await commitAndPush(token, {
    repo,
    branch,
    message: `Updated order for files in ${collectionRoute}`,
    files: files.map((f, i) => ({
      content: contents[i],
      path: f.path,
      mode: FileMode.FILE,
      type: 'blob' as const
    }))
  })

  return commit
}
