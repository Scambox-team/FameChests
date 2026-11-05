//! Poczta wychodząca: krótkie powiadomienia dla admina (np. o nowym zgłoszeniu karty).
//! Treść powiadomienia nie zawiera danych osobowych, tylko numer i rodzaj zgłoszenia - szczegóły są w panelu admina.
//! Błąd wysyłki nigdy nie psuje zapytania gracza: jest tylko zapisany w logu.

use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

use crate::config::{Config, Smtp, SmtpTls};

/// Czy powiadomienia są skonfigurowane (jest SMTP i adres odbiorcy)
pub fn enabled(cfg: &Config) -> bool {
    cfg.smtp.is_some() && cfg.notify_email.is_some()
}

fn transport(smtp: &Smtp) -> Result<AsyncSmtpTransport<Tokio1Executor>, lettre::transport::smtp::Error> {
    let builder = match smtp.tls {
        SmtpTls::StartTls => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&smtp.host)?,
        SmtpTls::Tls => AsyncSmtpTransport::<Tokio1Executor>::relay(&smtp.host)?,
        SmtpTls::None => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&smtp.host),
    };
    let builder = builder.port(smtp.port);
    let builder = match (&smtp.user, &smtp.password) {
        (Some(u), Some(p)) => builder.credentials(Credentials::new(u.clone(), p.clone())),
        _ => builder,
    };
    Ok(builder.build())
}

/// Wysyła wiadomość w tle; zwraca od razu. `subject` i `body` składamy tylko z tekstów serwera, nigdy z danych od graczy.
pub fn notify_admin(cfg: &Config, subject: String, body: String) {
    let (Some(smtp), Some(to)) = (cfg.smtp.clone(), cfg.notify_email.clone()) else { return };
    tokio::spawn(async move {
        let result = async {
            let msg = Message::builder()
                .from(smtp.from.parse()?)
                .to(to.parse()?)
                .subject(subject)
                .header(ContentType::TEXT_PLAIN)
                .body(body)?;
            transport(&smtp)?.send(msg).await?;
            anyhow::Ok(())
        }
        .await;
        match result {
            Ok(()) => tracing::info!("wysłano powiadomienie e-mail"),
            Err(e) => tracing::warn!("nie udało się wysłać powiadomienia e-mail: {e}"),
        }
    });
}
