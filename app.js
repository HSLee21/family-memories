// Slideshow state variables
let slideshowIndex = 0;
let slideshowPhotos = [];
const slideshowFallbackLabel = "Photo";

// Helper function to simulate element selection ($ wrapper)
function $(id) {
  return document.getElementById(id);
}

/**
 * Initializes the slideshow with an array of photos
 * @param {Array} photos - Array of photo objects containing signedUrl and optional _label
 */
function initSlideshow(photos) {
  if (!photos || !Array.isArray(photos) || photos.length === 0) {
    console.warn("No photos provided to initialize slideshow.");
    return;
  }
  slideshowPhotos = photos;
  slideshowIndex = 0;
  showSlide(slideshowIndex);
}

/**
 * Updates the slideshow view to display the photo at index i.
 * Safely handles opacity changes and prevents overlapping or flashing visual glitches.
 * @param {number} i - The target index of the photo to show
 */
function showSlide(i) {
  if (!slideshowPhotos.length) return;

  // Circular index wrapping
  slideshowIndex = (i + slideshowPhotos.length) % slideshowPhotos.length;
  const photo = slideshowPhotos[slideshowIndex];
  const img = $("slideshowImage");

  if (!img) {
    console.error("Required element #slideshowImage not found in the DOM.");
    return;
  }

  // 1. Temporarily disable transitions to hide the old image instantly
  img.style.transition = "none";
  img.style.opacity = 0;

  // 2. Change the source while the image is completely invisible
  img.src = photo.signedUrl;

  // 3. Once loaded, re-enable the transition and fade the new image up smoothly
  img.onload = () => {
    img.style.transition = "opacity .4s ease";
    img.style.opacity = 1;
  };

  // Update counters if element exists
  const counter = $("slideshowCounter");
  if (counter) {
    counter.textContent = `${slideshowIndex + 1} / ${slideshowPhotos.length}`;
  }

  // Update title/label if element exists
  const title = $("slideshowTitle");
  if (title) {
    const label = photo._label || slideshowFallbackLabel;
    title.textContent = label || "";
  }
}

/**
 * Navigates to the next slide
 */
function nextSlide() {
  showSlide(slideshowIndex + 1);
}

/**
 * Navigates to the previous slide
 */
function prevSlide() {
  showSlide(slideshowIndex - 1);
}
