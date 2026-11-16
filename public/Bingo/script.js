document.querySelectorAll(".filters button").forEach(button=>{
  button.addEventListener("click",()=>{
    document.querySelectorAll(".filters button").forEach(b=>b.classList.remove("active"));
    button.classList.add("active");
    document.querySelectorAll(".game-card").forEach(card=>{
      card.hidden=button.dataset.filter!=="all"&&card.dataset.category!==button.dataset.filter;
    });
  });
});
document.getElementById("surprise").addEventListener("click",()=>{
  window.location.href="/bingo.html";
});
