// ---------- Utilities ----------
const $ = (id) => document.getElementById(id);
const log = (msg) => {
  const el = $("log");
  el.hidden = false;
  el.textContent += `\n${new Date().toLocaleTimeString()} → ${msg}`;
};

function mapLink(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
function budgetLabel(b) {
  if (b === "low") return "$";
  if (b === "medium") return "$";
  if (b === "high") return "$$";
  return "$";
}

// ---------- Dynamic City Background ----------
function cityImageURL(city) {
  const q = encodeURIComponent(city);
  // Unsplash Source provides free, keyless random images
  return `https://source.unsplash.com/1600x900/?${q},landmark,cityscape`;
}
function setCityBackground(city) {
  const el = document.getElementById("cityBg");
  if (!el) return;
  const name = (city || "").trim();
  if (!name) {
    el.style.opacity = "0";
    el.style.backgroundImage = "";
    el.style.transform = "scale(1.02)";
    return;
  }
  const url = cityImageURL(name);
  // Start faded while loading
  el.style.opacity = "0.2";
  el.style.transform = "scale(1.02)";
  const img = new Image();
  img.onload = () => {
    el.style.backgroundImage = `url('${url}')`;
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "scale(1)";
    });
  };
  img.onerror = () => {
    el.style.opacity = "0";
  };
  img.referrerPolicy = "no-referrer";
  img.src = url;
}
function debounce(fn, wait = 500) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// ---------- Prompt Builder (for LLM) ----------
function buildSystemPrompt() {
  return `You are a smart travel planner. When a user gives you a city, budget, and number of days, you create a full day-by-day travel plan.

Your plan must include:
- Activities, sightseeing, and cultural experiences
- Dining recommendations (breakfast, lunch, dinner) based on budget
- Maps or location details (place names users can open in Google Maps)
- For every activity and dining recommendation: an approximate distance, a suitable travel option (walking or public transport), and the best time to visit/eat
- A short summary at the end of each day

Rules:
- Make the plan realistic (consider travel time, cost, and opening hours)
- Prefer walking if the distance is short; otherwise suggest public transport
- Mix popular attractions with hidden gems
- Adjust style (family, luxury, budget, adventure, cultural) if the user asks
- If details are missing, ask the user first
- Return the final plan in a clean, easy-to-read format`;
}
function buildUserPrompt(values) {
  const { city, days, budget, style, diet, pace } = values;
  return `Plan a trip to ${city} for ${days} days with a ${budget} budget.
Style: ${style}; Pace: ${pace}; Diet: ${diet || "none specified"}.
Create a day-by-day itinerary with activities and breakfast/lunch/dinner suggestions that fit the budget. Include place names (so I can open them in Google Maps), and for each activity and meal include: approximate distance, suggested travel option (walking or public transport), and the best time to visit/eat.`;
}

// ---------- Local Heuristic Generator (no AI) ----------
const CATEGORIES = {
  balanced: ["landmark", "museum", "park", "market", "neighborhood", "viewpoint", "riverfront", "hidden gem"],
  family: ["zoo", "theme park", "interactive museum", "park", "aquarium", "neighborhood", "market", "viewpoint"],
  adventure: ["hiking trail", "bike tour", "water activity", "city viewpoint", "market", "local street food", "sunset spot"],
  luxury: ["iconic landmark", "art museum", "boutique district", "fine dining", "spa", "sky bar", "river cruise"],
  budget: ["free walking tour", "public park", "local market", "street food lane", "neighborhood", "viewpoint"],
  cultural: ["historic district", "temple or church", "national museum", "local craft market", "heritage walk", "traditional performance"],
};

function pick(list, n) {
  const out = [];
  const copy = [...list];
  while (out.length < n) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0] || list[i % list.length]);
  }
  return out;
}

function mealQuery(meal, city, budget, diet) {
  let base = meal + " restaurants " + city;
  if (diet) base = diet + " " + base;
  if (budget) base = (budget + " " + base).trim();
  return base;
}

// Heuristics for distance, transport mode, and best time
function randFloat(min, max) { return +(Math.random()*(max-min)+min).toFixed(1); }
function travelModeForKm(km) { return km <= 1.7 ? "Walking" : "Public transport"; }
function bestTimeForSlot(slot) {
  const s = (slot || "").toLowerCase();
  if (s.includes("late") || s === "midday") return "midday (12–2pm)";
  if (s.includes("morning")) return "morning (8–11am)";
  if (s.includes("afternoon")) return "afternoon (1–4pm)";
  if (s.includes("evening")) return "evening (5–8pm)";
  return "anytime";
}
function bestTimeForMeal(type) {
  const t = (type || "").toLowerCase();
  if (t.includes("breakfast")) return "morning (8–10am)";
  if (t.includes("lunch")) return "midday (12–2pm)";
  if (t.includes("dinner")) return "evening (7–9pm)";
  return "anytime";
}

function generateLocalPlan(values) {
  const { city, days, budget, style, diet, pace } = values;
  const cat = CATEGORIES[style] || CATEGORIES.balanced;
  const daysInt = Math.max(1, Math.min(30, parseInt(days, 10) || 1));
  const results = [];
  const paceSlots =
    pace === "packed"
      ? ["Morning", "Midday", "Afternoon", "Evening"]
      : pace === "relaxed"
      ? ["Late Morning", "Afternoon", "Evening"]
      : ["Morning", "Afternoon", "Evening"];

  for (let d = 1; d <= daysInt; d++) {
    const slots = pick(cat, paceSlots.length);
    const items = paceSlots.map((slot, idx) => {
      const tag = slots[idx];
      const q = `${tag} in ${city}`;
      const distanceKm = randFloat(0.4, 3.5);
      const mode = travelModeForKm(distanceKm);
      const best = bestTimeForSlot(slot);
      return { slot, title: tag.charAt(0).toUpperCase() + tag.slice(1), link: mapLink(q), distanceKm, mode, bestTime: best };
    });

    const meals = [
      { type: "Breakfast", q: mealQuery("breakfast", city, budgetLabel(budget), diet) },
      { type: "Lunch", q: mealQuery("lunch", city, budgetLabel(budget), diet) },
      { type: "Dinner", q: mealQuery("dinner", city, budgetLabel(budget), diet) },
    ].map((m) => {
      const distanceKm = randFloat(0.2, 2.0);
      const mode = travelModeForKm(distanceKm);
      return { type: m.type, link: mapLink(m.q), distanceKm, mode, bestTime: bestTimeForMeal(m.type) };
    });

    const summary = `Day ${d} blends ${items.map((i) => i.title.toLowerCase()).join(", ")} with ${budget} budget meals${
      diet ? ` (${diet})` : ""
    }.`;

    results.push({ day: d, items, meals, summary });
  }
  return results;
}

function renderPlan(plan, meta) {
  const { city } = meta;
  if (!plan || !plan.length) {
    $("output").innerHTML = "No plan generated.";
    return;
  }
  const html = plan
    .map((d) => {
      const items = d.items
        .map((it) => `<li><span class="pill">${it.slot}</span> <a href="${it.link}" target="_blank" rel="noopener">${it.title} — in ${city}</a> <span class="meta">• ~${it.distanceKm} km • ${it.mode} • best: ${it.bestTime}</span></li>`)
        .join("");
      const meals = d.meals
        .map((m) => `<li><span class="pill">${m.type}</span> <a href="${m.link}" target="_blank" rel="noopener">Open ${m.type} options near ${city}</a> <span class="meta">• ~${m.distanceKm} km • ${m.mode} • best: ${m.bestTime}</span></li>`)
        .join("");
      return `<div class="day"><h3>Day ${d.day}</h3>
        <div class="meta">Tap links to open Google Maps searches.</div>
        <ul>${items}</ul>
        <h4>Food</h4>
        <ul>${meals}</ul>
        <div class="meta">Summary: ${d.summary}</div>
      </div>`;
    })
    .join("");
  $("output").innerHTML = html;
}

// ---------- AI Call (optional, BYO endpoint/key) ----------
async function generateAI(values) {
  const endpoint = $("aiEndpoint").value.trim();
  const model = $("aiModel").value.trim();
  const key = $("aiKey").value.trim();
  const maxTokens = parseInt($("maxTokens").value || 900, 10);
  if (!endpoint || !model || !key) {
    alert("To use AI, provide endpoint, model, and API key — or toggle off 'Use AI'.");
    throw new Error("Missing AI credentials");
  }
  const payload = {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: buildUserPrompt(values) },
    ],
    temperature: 0.8,
    max_tokens: maxTokens,
  };
  log("Calling AI endpoint…");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error("AI error: " + res.status + " — " + t);
  }
  const data = await res.json();
  // Try to extract text in common shapes (OpenAI-compatible)
  const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || JSON.stringify(data);
  $("output").textContent = (text || "").trim();
  log("AI response rendered.");
}

// ---------- Event Handlers ----------
$("generate").addEventListener("click", async () => {
  const values = {
    city: $("city").value.trim(),
    days: $("days").value.trim(),
    budget: $("budget").value || "medium",
    style: $("style").value || "balanced",
    diet: $("diet").value.trim(),
    pace: $("pace").value || "moderate",
  };
  if (!values.city) {
    alert("Please enter a city.");
    return;
  }
  if (!values.days) {
    alert("Please enter number of days.");
    return;
  }

  setCityBackground(values.city);

  try {
    if ($("useAI").checked) {
      await generateAI(values);
    } else {
      const plan = generateLocalPlan(values);
      renderPlan(plan, values);
      log("Local plan generated.");
    }
  } catch (err) {
    console.error(err);
    log(err.message);
    alert(err.message);
  }
});

$("copyPrompt").addEventListener("click", () => {
  const values = {
    city: $("city").value.trim() || "<City>",
    days: $("days").value.trim() || "<Days>",
    budget: $("budget").value || "medium",
    style: $("style").value || "balanced",
    diet: $("diet").value.trim() || "none",
    pace: $("pace").value || "moderate",
  };
  const sys = buildSystemPrompt();
  const usr = buildUserPrompt(values);
  const prompt = `SYSTEM:\n${sys}\n\nUSER:\n${usr}`;
  navigator.clipboard.writeText(prompt).then(() => {
    log("Prompt copied to clipboard.");
    alert("AI prompt copied. Paste it into your model playground or backend.");
  });
});

$("clear").addEventListener("click", () => {
  ["city", "days", "diet", "aiKey", "aiEndpoint", "aiModel"].forEach((id) => ($(`${id}`).value = ""));
  $("budget").value = "";
  $("style").value = "balanced";
  $("pace").value = "moderate";
  $("output").innerHTML = "Cleared. Enter details and generate again.";
  $("log").textContent = "";
  $("log").hidden = true;
  setCityBackground("");
});

// Live-update background as user types city (debounced)
$("city").addEventListener("input", debounce(() => {
  setCityBackground($("city").value.trim());
}, 500));
