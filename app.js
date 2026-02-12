/* Vue 2, no build tools, no router, no <template> tags needed.
   Local mode: ratings/comments stored in localStorage.
   Later: swap the storage functions with API calls to Cloudflare Worker.
*/

(function () {

  const API = "https://damp-wind-8900.darshgb.workers.dev";

  const LS = {
    ratingsKey: "booksite_ratings_v1",
    commentsKey: "booksite_comments_v1"
  };

  function safeParse(json, fallback) {
    try { return JSON.parse(json) ?? fallback; } catch { return fallback; }
  }

  function loadRatings() {
    return safeParse(localStorage.getItem(LS.ratingsKey), []);
  }
  function saveRatings(rows) {
    localStorage.setItem(LS.ratingsKey, JSON.stringify(rows));
  }

  function loadComments() {
    return safeParse(localStorage.getItem(LS.commentsKey), []);
  }
  function saveComments(rows) {
    localStorage.setItem(LS.commentsKey, JSON.stringify(rows));
  }

  new Vue({
    el: "#app",
    data: {
      site: {
        title: "Time Empire",
        subtitle: "Stories, novels, and everything I’m building.",
        author: "Darshan Goburdhone"
      },
      books: [],
      query: "",
      genreFilter: "",
      activeBook: null,

      // Local storage caches
      ratings: loadRatings(),   // [{id, bookId, rating, createdAt}]
      comments: loadComments(), // [{id, bookId, name, email, text, createdAt}]

      // Draft UI
      myDraftRating: 0,
      commentDraft: { name: "", email: "", text: "" }
    },
    computed: {
      genres: function () {
        const set = new Set(this.books.map(b => b.genre).filter(Boolean));
        return Array.from(set).sort((a, b) => a.localeCompare(b));
      },
      filteredBooks: function () {
        const q = (this.query || "").trim().toLowerCase();
        const gf = (this.genreFilter || "").trim().toLowerCase();

        let list = this.books.filter(b => {
            const matchesGenre = !gf || (b.genre || "").toLowerCase() === gf;
            if (!q) return matchesGenre;

            const hay = [
            b.title, b.genre, b.status, b.blurb,
            (b.tags || []).join(" ")
            ].join(" ").toLowerCase();

            return matchesGenre && hay.includes(q);
        });

        // ⭐ ADD THIS PART
        return list.sort((a, b) =>
            a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
        );
      }
    },
    methods: {
      async init() {
        const res = await fetch("./books.json", { cache: "no-store" });
        this.books = await res.json();
      },

      async refreshSummary(bookId) {
        const res = await fetch(`${API}/api/books/${bookId}/summary`);
        const data = await res.json();

        this._apiSummary = this._apiSummary || {};
        this._apiSummary[bookId] = data;
        },

      async loadComments(bookId) {
        const res = await fetch(`${API}/api/books/${bookId}/comments`);
        const data = await res.json();

        this.comments = data.comments || [];
        },

      coverStyle(b) {
        if (b.cover) return { backgroundImage: `url(${b.cover})` };
        // fallback gradient
        return { backgroundImage: "linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02))" };
      },

      async openBook(b) {
        this.activeBook = b;
        await this.refreshSummary(b.id);
        await this.loadComments(b.id);
        },


      closeBook() {
        this.activeBook = null;
        this.myDraftRating = 0;
        document.body.style.overflow = "";
      },

      // ---------- Ratings (local demo) ----------
      avgRating(bookId) {
        const rs = this.ratings.filter(r => r.bookId === bookId);
        if (rs.length === 0) return 0;
        const sum = rs.reduce((a, r) => a + r.rating, 0);
        return sum / rs.length;
      },
      ratingCount(bookId) {
        return this.ratings.filter(r => r.bookId === bookId).length;
      },
      setDraftRating(n) {
        this.myDraftRating = n;
      },
      getMyLocalRating(bookId) {
        // local "device rating": last rating for this book
        const mine = this.ratings
          .filter(r => r.bookId === bookId && r.device === this.deviceId())
          .sort((a, b) => b.createdAt - a.createdAt)[0];
        return mine ? mine.rating : 0;
      },
      clearMyRating() {
        if (!this.activeBook) return;
        const bookId = this.activeBook.id;
        const dev = this.deviceId();
        this.ratings = this.ratings.filter(r => !(r.bookId === bookId && r.device === dev));
        saveRatings(this.ratings);
        this.myDraftRating = 0;
      },
      async submitRating() {
        if (!this.activeBook || !this.myDraftRating) return;

        const token = window.turnstile.getResponse();
        if (!token) {
            alert("Please verify you are human");
            return;
        }

        await fetch(`${API}/api/books/${this.activeBook.id}/rate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
            stars: this.myDraftRating,
            turnstileToken: token
            })
        });

        window.turnstile.reset();
        await this.refreshSummary(this.activeBook.id);
        },

      // ---------- Comments (local demo) ----------
      commentsFor(bookId) {
        return this.comments
          .filter(c => c.bookId === bookId)
          .sort((a, b) => b.createdAt - a.createdAt);
      },
      async submitComment() {
        if (!this.activeBook) return;

        const token = window.turnstile.getResponse();
        if (!token) {
            alert("Please verify you are human");
            return;
        }

        const res = await fetch(`${API}/api/books/${this.activeBook.id}/comment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
            ...this.commentDraft,
            turnstileToken: token
            })
        });

        const data = await res.json();

        if (data.ok) {
            alert("Comment submitted for approval ❤️");
            this.commentDraft = { name: "", email: "", text: "" };
        }

        window.turnstile.reset();
        },


      formatDate(ts) {
        try {
          const d = new Date(ts);
          return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
        } catch {
          return "";
        }
      },

      // ---------- helpers ----------
      deviceId() {
        // stable per browser
        const key = "booksite_device_id_v1";
        let id = localStorage.getItem(key);
        if (!id) {
          id = cryptoRandomId();
          localStorage.setItem(key, id);
        }
        return id;
      }
    },
    mounted() {
      this.init();
      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.activeBook) this.closeBook();
      });
    }
  });

  function cryptoRandomId() {
    // simple safe id
    if (window.crypto && crypto.getRandomValues) {
      const a = new Uint32Array(4);
      crypto.getRandomValues(a);
      return Array.from(a).map(x => x.toString(16).padStart(8, "0")).join("");
    }
    return String(Date.now()) + Math.random().toString(16).slice(2);
  }
})();
