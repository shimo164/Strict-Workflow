(function () {
  function createOverlay() {
    const overlay = document.createElement("div");
    overlay.id = "pomodoro-extension-overlay";
    Object.assign(overlay.style, {
      position: "fixed",
      left: 0,
      top: 0,
      width: "100%",
      height: "100%",
      zIndex: 9000001,
      backgroundImage: "-webkit-linear-gradient(bottom, #ccc 0%, #fff 75%)",
      padding: "5em 1em 1em",
      textAlign: "center",
      color: "#000",
      font: "normal normal normal 16px/1 sans-serif",
    });

    const img = document.createElement("img");
    img.src = chrome.runtime.getURL("icons/work_full.png");
    img.style.margin = "0 auto 1em auto";
    overlay.appendChild(img);

    const lines = [
      chrome.i18n.getMessage("site_blocked_info"),
      chrome.i18n.getMessage("site_blocked_motivator"),
    ];
    lines.forEach((line) => {
      const p = document.createElement("p");
      p.innerText = line;
      p.style.margin = "0 0 .5em 0";
      overlay.appendChild(p);
    });

    return overlay;
  }

  function ready() {
    if (!document.getElementById("pomodoro-extension-overlay")) {
      document.body.appendChild(createOverlay());
    }
  }

  if (typeof document === "undefined") {
    window.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
})();
