const filterButtons = document.querySelectorAll(".filter-btn");
const gameCards = document.querySelectorAll(".game-card");
const emptyState = document.getElementById("empty-state");
const surpriseButton = document.getElementById("surprise-btn");

function filterGames(category) {
  let visibleCount = 0;

  gameCards.forEach(card => {
    const matches = category === "all" || card.dataset.category === category;
    card.hidden = !matches;
    if (matches) visibleCount++;
  });

  if (emptyState) emptyState.hidden = visibleCount !== 0;

  filterButtons.forEach(button => {
    const active = button.dataset.filter === category;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

filterButtons.forEach(button => {
  button.addEventListener("click", () => filterGames(button.dataset.filter));
});

if (surpriseButton) {
  surpriseButton.addEventListener("click", () => {
    const playable = [...gameCards].filter(card => card.classList.contains("bingo-card"));
    const allGames = [...gameCards];
    const chosen = allGames[Math.floor(Math.random() * allGames.length)];

    if (chosen.classList.contains("bingo-card")) {
      window.location.href = "./bingo.html";
      return;
    }

    filterGames("all");
    chosen.scrollIntoView({ behavior: "smooth", block: "center" });
    chosen.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.04)" }, { transform: "scale(1)" }],
      { duration: 550 }
    );
  });
}

filterGames("all");
