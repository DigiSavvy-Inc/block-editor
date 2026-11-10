// The image upload contract between the editor and its host. The editor never talks to a
// server itself: it hands the file to this function and stores the URL it gets back.

/**
 * Stores an image and resolves to the URL the image block should use (`src`). The URL is
 * written into the blocks as-is, so it must be one your renderers and email recipients can
 * load (absolute, usually https).
 *
 * Called for: the Design panel's "Upload image" button, an image file pasted or dropped
 * into the editor, and an aspect-ratio crop (the cropped image is a new WebP or JPEG file).
 * Before the call the editor converts an AVIF file to WebP (else JPEG) in the browser;
 * every other file arrives untouched.
 *
 * Reject (throw) to fail: an `Error`'s message is shown to the user under the upload
 * button, otherwise "Upload failed.". Resolving to anything but a non-empty string also
 * shows "Upload failed.".
 */
export type ImageUpload = (file: File) => Promise<string>;
