// Vite supplies BASE_URL for both root and subdirectory deployments.
export const assetUrl = (relative: string) => `${import.meta.env.BASE_URL}${relative.replace(/^\/+/, '')}`;
