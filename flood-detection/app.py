"""Flood Detection & Alert: Flask app (Step 0: templates only, sample data).

Run:   pip install -r requirements.txt
       flask --app app run --debug        (then open http://127.0.0.1:5000)
"""
from flask import Flask, render_template

app = Flask(__name__)  # templates/ and static/ sit next to this file


# ---- Public pages -----------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/weather")
def weather():
    return render_template("weather.html")


@app.route("/reports")
def reports():
    return render_template("reports.html")


@app.route("/reports/<int:report_id>")
def report_details(report_id):
    return render_template("report-details.html", report_id=report_id)


@app.route("/report")
def report():
    return render_template("report.html")


@app.route("/result")
def result():
    return render_template("result.html")


@app.route("/map")
def map_view():
    return render_template("map.html")


# ---- Signed-in pages --------------------------------------------------------
@app.route("/routes")
def routes():
    return render_template("routes.html")


@app.route("/schedules")
def schedules():
    return render_template("schedules.html")


@app.route("/notifications")
def notifications():
    return render_template("notifications.html")


# ---- Moderator area ---------------------------------------------------------
@app.route("/moderation")
def moderation():
    return render_template("moderation.html")


# ---- Accounts ---------------------------------------------------------------
@app.route("/auth/login")
def login():
    return render_template("auth/login.html")


@app.route("/auth/register")
def register():
    return render_template("auth/register.html")


if __name__ == "__main__":
    app.run(debug=True)
