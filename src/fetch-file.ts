export const fetchFile = async (url: string): Promise<Response> => {
	const response = await fetch(url)
	const isPageFallback = response.headers.get("content-type")?.startsWith("text/html")
	if (response.status === 404 || isPageFallback) throw new Error(`${url} was not found.`)
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
	return response
}
