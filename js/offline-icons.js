
(function () {
  const iconTemplates = {
    leaf: `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M11 20A7 7 0 0 1 4 13c0-5 4-9 9-9 3 0 6 2 8 4-1 2-4 8-10 12Z"></path>
        <path d="M4 13c4 0 7 1 10 4"></path>
      </svg>
    `,

    bell: `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M10.268 21a2 2 0 0 0 3.464 0"></path>
        <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"></path>
      </svg>
    `,

    "log-out": `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
        <polyline points="16 17 21 12 16 7"></polyline>
        <line x1="21" x2="9" y1="12" y2="12"></line>
      </svg>
    `,

    x: `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M18 6 6 18"></path>
        <path d="m6 6 12 12"></path>
      </svg>
    `,

    thermometer: `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"></path>
      </svg>
    `,

    droplets: `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M7 16.3c2.2 0 4-1.8 4-4C11 10.1 7 5 7 5s-4 5.1-4 7.3c0 2.2 1.8 4 4 4Z"></path>
        <path d="M17 20c2.2 0 4-1.8 4-4 0-2.2-4-7.3-4-7.3S13 13.8 13 16c0 2.2 1.8 4 4 4Z"></path>
      </svg>
    `,

    clock: `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
    `,

    camera: `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"></path>
        <circle cx="12" cy="13" r="3"></circle>
      </svg>
    `,

    "chevron-left": `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="m15 18-6-6 6-6"></path>
      </svg>
    `,

    "chevron-right": `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="m9 18 6-6-6-6"></path>
      </svg>
    `,

    "alert-triangle": `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
        <path d="M12 9v4"></path>
        <path d="M12 17h.01"></path>
      </svg>
    `,

    "check-circle": `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M9 12l2 2 4-4"></path>
        <circle cx="12" cy="12" r="10"></circle>
      </svg>
    `,

    bug: `
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="m8 2 1.88 1.88"></path>
        <path d="M14.12 3.88 16 2"></path>
        <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"></path>
        <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"></path>
        <path d="M12 20v-9"></path>
        <path d="M6.53 9C4.6 8.8 3 7.1 3 5"></path>
        <path d="M6 13H2"></path>
        <path d="M3 21c0-2.1 1.7-3.8 3.8-4"></path>
        <path d="M17.47 9C19.4 8.8 21 7.1 21 5"></path>
        <path d="M18 13h4"></path>
        <path d="M21 21c0-2.1-1.7-3.8-3.8-4"></path>
      </svg>
    `
  };

  function createIcons() {
    const elements = document.querySelectorAll("[data-lucide]");

    elements.forEach((el) => {
      const iconName = el.getAttribute("data-lucide");
      const template = iconTemplates[iconName];

      if (!template) return;

      const strokeWidth = el.getAttribute("stroke-width") || "2";

      el.innerHTML = template;

      const svg = el.querySelector("svg");

      if (svg) {
        svg.setAttribute("stroke-width", strokeWidth);
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        svg.style.display = "block";
      }
    });
  }

  window.lucide = {
    createIcons
  };

  document.addEventListener("DOMContentLoaded", createIcons);
})();
