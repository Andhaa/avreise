# Avreise

Et lite værskilt for døren med ett spørsmål: **Trenger du paraply?**

Prosjektet har to presentasjoner bygget fra den samme normaliserte værmodellen og den samme beslutningslogikken:

- en responsiv webside for eldre iOS-/Android-nettbrett og vanlige nettlesere;
- et statisk PNG-bilde på `/status.png` for en enkel e-leser, Kindle eller bildefremviser.

## Kom i gang

Prosjektet har ingen npm-avhengigheter. Kjør Node.js 20 eller nyere. Ubuntu 22.04 sin eldre standardpakke for Node er ikke tilstrekkelig for serveren:

```bash
npm start
```

Åpne [http://localhost:8787](http://localhost:8787).

For the documented VPS topology, see [deploy/README.md](deploy/README.md). The production deployment is designed for the VPS `serv`, behind the existing Nginx/TLS entry point at `arhp.no/umbrella/`. It binds the Node process to `127.0.0.1:8787`, so no new public firewall port is needed.

Standardoppsettet bruker fersk demodata slik at siden fungerer uten nettverk under utvikling. For live vær fra MET Norway:

```bash
WEATHER_MODE=auto npm start
```

`auto` prøver MET Nowcast først og bruker MET Locationforecast som fallback. Hvis begge feiler, viser appen en tydelig merket demoforecast i stedet for å late som om gammel data er fersk. `WEATHER_MODE=live` feiler i stedet for å bruke demodata når live-kilden ikke kan nås.

## Statisk bilde

PNG-endepunktet har samme anbefaling, sted, avreisevindu og siste oppdatering som websiden:

```text
http://localhost:8787/status.png?width=800&height=600
http://localhost:8787/status.png?width=600&height=800
```

Sted kan sendes med koordinater og etikett:

```text
/status.png?lat=59.9139&lon=10.7522&label=Oslo&width=800&height=600
```

On the VPS, the equivalent public path is:

```text
https://arhp.no/umbrella/status.png?width=800&height=600
```

PNG-rendereren bruker ImageMagick sitt `convert`-program med systemfonter. Det gjør bildet uavhengig av JavaScript når det er lastet ned, men produksjonsmaskinen må ha ImageMagick installert. En Raspberry Pi eller e-leser kan hente bildet på forespørsel, men selve PNG-filen oppdaterer ikke enheten av seg selv. For MVP-en er refresh-mekanismen derfor manuell: åpne eller last URL-en på nytt.

## Produktbeslutninger

- Målgruppe: ett hushold.
- Geografi: Norge og øvrig nordisk MET Nowcast-dekning; Locationforecast kan brukes globalt.
- Skjerm: primært eldre iOS-/Android-nettbrett; layouten fungerer i både landskap og portrett.
- Bilde: PNG med kanoniske dimensjoner `800 × 600` og `600 × 800`.
- Avreisevindu: fra lokal tid nå og 90 minutter frem.
- Paraplyterskel: målbar nedbør på minst `0,1 mm`, eller minst `40 %` nedbørssannsynlighet når mengde mangler.
- Ferskhet: data eldre enn 30 minutter gir `VÆRDATA UKJENT`.
- Tidssone: visning bruker nettleserens eller serverens lokale klokke. Dette er dokumentert som en MVP-antakelse; en fremtidig distribusjon som dekker flere tidssoner bør sende stedets tidssone eksplisitt.
- Radar: Nowcast brukes som beslutningsgrunnlag når `radar_coverage` er `ok`. Ved `no coverage` eller `temporarily unavailable` brukes Locationforecast som lavere-konfidens fallback.
- Stedsvalg: første gangs bruk starter uten en skjult standardposisjon. Brukeren kan skrive inn navn + breddegrad/lengdegrad, eller trykke «Bruk enhetens posisjon». Geolokasjon spørres bare etter dette eksplisitte trykket, henter én fersk posisjon og lagres kun lokalt.

## Værkilde og personvern

Serveradapteren bruker den offisielle [MET Norway Nowcast 2.0-dokumentasjonen](https://api.met.no/weatherapi/nowcast/2.0/documentation) og [Locationforecast 2.0 compact](https://api.met.no/weatherapi/locationforecast/2.0/documentation). MET krever en identifiserende `User-Agent`; adapteren sender `Avreise/1.0` med prosjekt-URL. Koordinater rundes til fire desimaler før forespørsel.

Appen lagrer bare valgt sted i nettleserens `localStorage`. Den sporer ikke posisjon i bakgrunnen, lagrer ingen stedshistorikk og logger ikke rå koordinater eller rå provider-svar.

### Nettleserens posisjonstillatelse

Posisjon fungerer bare i en sikker nettleserkontekst, altså på `https://arhp.no/umbrella/` eller `localhost`. Appen sender `Permissions-Policy: geolocation=(self)` slik at appens egen side uttrykkelig kan be om posisjon. Ved Nginx-deploy må location-konfigurasjonen skjule en eventuell arvet `Permissions-Policy`/`Feature-Policy` og sende denne policyen én gang; flere policyer kombineres, så en arvet `geolocation=()` vil ellers blokkere posisjon selv om nettstedstillatelsen viser «Tillat».

Appen kaller `getCurrentPosition()` direkte som svar på trykket på «Bruk enhetens posisjon». Det starter nettleserens vanlige tillatelsesdialog når nettstedets status er `prompt`. Hvis tillatelsen tidligere er avslått, viser appen en konkret beskjed om å åpne nettstedstillatelser via hengelåsen i adressefeltet; nettlesere viser normalt ikke dialogen på nytt før brukeren endrer denne innstillingen. Hvis posisjon ikke støttes eller ikke kan hentes, kan et fast sted brukes uten at posisjonsdata sendes.

Et fast sted lagres med navn og koordinater i fire desimaler. Når et sted er valgt, vises det tydelig om kilden er «Enhetens posisjon» eller «Fast sted», og værkallet går til appens server med den valgte posisjonen. Det finnes ingen `watchPosition()` og ingen bakgrunnssporing.

## Verifisering

```bash
npm run check
npm test
```

Testene dekker beslutningslogikken for tørrvær, regn, drizzle under/over terskel, sannsynlighet alene, manglende felt, foreldet data, radardekning og vindu over midnatt. Provider-testene bruker mockede 200-, 304- og fallback-svar. PNG-testene sjekker heading/anbefaling i SVG-kilden og at de genererte PNG-filene er gyldige med riktige dimensjoner.

Det finnes ingen live værkall i testene. Dette holder CI og offline-skilt stabile.
