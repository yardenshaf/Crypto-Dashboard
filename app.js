"use strict";

(async () => {

    const API_KEY = 'b0d6cb68640f992f2380a8a4d972d143166d40e6156b90c8ac9512345ea9c716'
    const chosenCoins = new Set();
    let sixthCoinChosen = null
    const CACHE_AGE_IN_SEC = 10;

    const getDataFromAPI = async (url, options = {}) => {
        let cached = localStorage.getItem(url);
        if (cached) {
            try { // make sure that the user choice is saved, but the prices on more info update
                const { data, createdAt } = JSON.parse(cached);
                const expired = Date.now() >= createdAt + CACHE_AGE_IN_SEC * 1000;

                if (!expired) {
                    console.log("cache hit");
                    return data;
                } else {
                    console.log("cache expired, refetching...");
                    localStorage.removeItem(url); // delete old one
                }
            } catch { }
        }

        const res = await fetch(url, options);
        const data = await res.json();

        localStorage.setItem(
            url,
            JSON.stringify({ data, createdAt: Date.now() })
        );
        console.log("cache miss");
        return data;
    };

    const saveSelected = () =>
        localStorage.setItem('selectedCoins', JSON.stringify([...chosenCoins]));

    const loadSelected = () => {
        try { return JSON.parse(localStorage.getItem('selectedCoins') || '[]'); }
        catch { return []; }
    };

    loadSelected().map(id => chosenCoins.add(id))


    const renderHTML = (html, target) => {
        document.getElementById(target).innerHTML = html;
    };

    const fetchCoinsData = async () => {
        return getDataFromAPI(
            'https://rest.coincap.io/v3/assets',
            {
                headers: {
                    accept: 'application/json',
                    Authorization: `Bearer ${API_KEY}`
                }
            }
        );
    };

    const fetchCoinsPrices = async chosenCoins => {
        const res = await fetch(
            `https://rest.coincap.io/v3/assets?ids=${[...chosenCoins].join(',')}`,
            {
                headers: {
                    accept: 'application/json',
                    Authorization: `Bearer ${API_KEY}`
                }
            }
        );
        return res.json();
    };

    const generateCoinsHTML = coins => {
        return coins.map(({ symbol, id, priceUsd }) => {
            return `
      <div class="card p-3 mb-3">
        <div class="d-flex justify-content-between align-items-center">
          <div>
            <h5 class="mb-0">${symbol}</h5>
            <small>${id}</small>
          </div>
          <div class="form-check form-switch">
            <input 
              class="form-check-input coin-toggle " 
              type="checkbox" 
              data-coin-id="${id}" 
              data-symbol="${symbol}">
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-sm mt-2"
          data-bs-toggle="popover"
          data-bs-trigger="hover" 
          data-bs-placement="right"
          data-bs-content="
            Price in USD: $${(+priceUsd).toFixed(2)} <br> 
            Price in Euro: €${((+priceUsd) * 1.17).toFixed(2)} <br>
            Price in Shekel: ₪${((+priceUsd) * 3.39).toFixed(2)}
          ">
          More Info
        </button>
      </div>
    `;
        }).join('');
    };

    const renderCoinsCards = html => {
        renderHTML(html, "coins-list");

        const popoverTriggerList = document.querySelectorAll('[data-bs-toggle="popover"]');
        [...popoverTriggerList].forEach(el => new bootstrap.Popover(el, { html: true })); //bootstrap's code

        document.querySelectorAll('.coin-toggle').forEach(toggle => {
            if (chosenCoins.has(toggle.dataset.coinId)) {
                toggle.checked = true;
            }
        });
    };

    const alertModal = (sixthCoinChosen) => {

        let modalElement = document.getElementById('modal');
        let modal = new bootstrap.Modal(modalElement);
        modal.show();

        document.getElementById('modal-choice').innerHTML =
            `${[...chosenCoins].map((id) =>
                `<button class="deselect btn btn-outline-danger m-2"
             id="deselect-${id}" 
             data-coin-id="${id}" 
             >${id}</button>`).join('')}`;

        const handler = (event) => {
            const btn = event.target.closest('.deselect');
            if (!btn) return;

            const coinId = btn.dataset.coinId;
            chosenCoins.delete(coinId);
            chosenCoins.add(sixthCoinChosen);
            saveSelected();

            const removed = document.querySelector(`.coin-toggle[data-coin-id="${coinId}"]`);
            const added = document.querySelector(`.coin-toggle[data-coin-id="${sixthCoinChosen}"]`);
            if (removed) removed.checked = false;
            if (added) added.checked = true;

            updateChart();
            modal.hide();
            document.getElementById('modal-choice').removeEventListener('click', handler);
        };
        document.getElementById('modal-choice').addEventListener('click', handler);


    }



    document.getElementById('coins-list').addEventListener('change', event => {
        if (!event.target.classList.contains('coin-toggle')) return
        const coinId = event.target.dataset.coinId;

        if (!event.target.checked) {
            chosenCoins.delete(coinId);
            console.log([...chosenCoins]);
            updateChart();
            saveSelected();
            return;
        }

        if (chosenCoins.size >= 5) {
            sixthCoinChosen = coinId
            event.target.checked = false;
            alertModal(coinId)
            saveSelected();
            return;
        }

        chosenCoins.add(coinId);
        updateChart()
        saveSelected()
        console.log([...chosenCoins]);
    });

    try {
        document.getElementById('loading').style.display = 'flex'; // show a lodaing bar
        const { data } = await fetchCoinsData();
        const allCoins = data
        const html = generateCoinsHTML(data);
        renderCoinsCards(html);

        document.getElementById('coin-search').addEventListener('keyup', event => {
            const searchedCoin = document.getElementById('coin-search').value.trim().toLowerCase();
            // search for coins via id and symbol, if nothing is inside the input, show all coins
            const filteredCoins = searchedCoin
                ? allCoins.filter(({ symbol, id }) =>
                    symbol.toLowerCase().includes(searchedCoin) ||
                    id.toLowerCase().includes(searchedCoin)
                )
                : allCoins;

            const html = generateCoinsHTML(filteredCoins);

            renderCoinsCards(html);
        });

    } catch (err) {
        console.error(err);
        renderHTML(`<div class="text-danger">Out of luck and out of fetch calls:)</div>`, "coins-list");
    } finally {
        document.getElementById('loading').style.display = 'none'
    }

    //                                          ======Charts=======
    const labels = []; // save the timestamps on the chart 
    const basePrices = {}; // get the first price of each selected coin, well manipulate it later on
    const coinDatasets = {};

    const chartCanvas = document.getElementById('priceChart');


    //create a new chart.js 
    const chart = new Chart(chartCanvas, {
        type: 'line',
        data: { labels, datasets: [] },
        options: {
            responsive: true,
            animation: true,
            maintainAspectRatio: false,
            plugins: { colors: { enabled: true, forceOverride: true } },
            interaction: { mode: 'index', intersect: false },
            scales: {
                y: {
                    title: { display: true, text: '% change from start' },
                    ticks: { callback: v => `${(+v).toFixed(2)}%` } // chart code, no alt for callback
                }
            }
        }
    });




    document.getElementById('loading').style.display = 'flex';
    const updateChart = async () => {

        if (chosenCoins.size === 0) return; // dont call the api on load

        const { data } = await fetchCoinsPrices(chosenCoins);

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        labels.push(time);
        if (labels.length > 40) labels.shift(); // if there are more than 40 labels, start deleting the old ones

        const updatedDatasets = data.reduce((sum, { id, symbol, priceUsd }) => {
            const price = (+priceUsd);
            if (!basePrices[id]) basePrices[id] = price;

            const percentChange = ((price - basePrices[id]) / basePrices[id]) * 100; // the formula to calculate the percent change

            if (!coinDatasets[id]) {
                coinDatasets[id] = {
                    label: `${symbol} (%)`,
                    data: Array(Math.max(0, labels.length - 1)).fill(null),
                    pointRadius: 0,
                    borderWidth: 2,
                    tension: 0.25,
                    fill: false,
                    spanGaps: true,
                    id: id
                };
            }

            const dataset = coinDatasets[id];
            dataset.data.push(percentChange);
            if (dataset.data.length > 40) dataset.data.shift();

            sum.push(dataset);
            return sum;
        }, []);

        // search inside the chart datasets and remove the coins that are no longer in chosenCoins
        chart.data.datasets = updatedDatasets.filter(dataset => {
            const keep = chosenCoins.has(dataset.id);
            if (!keep) {
                delete coinDatasets[dataset.id];
                delete basePrices[dataset.id];
            }
            return keep;
        });

        chart.update();
    }

    try {
        updateChart();
        setInterval(updateChart, 30000);

    } catch (error) {
        console.error(error);
        renderHTML(`<div class="text-danger">No chart for you</div>`, "coins-list");
    } finally {
        document.getElementById('loading').style.display = 'none'

    }

})();
