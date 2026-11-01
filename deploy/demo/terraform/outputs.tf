output "hostname" {
  value = aws_route53_record.demo.fqdn
}

output "url" {
  value = "https://${aws_route53_record.demo.fqdn}"
}

output "public_ip" {
  value = aws_eip.demo.public_ip
}

output "ssh" {
  value = "ssh -i ~/.ssh/joplock-demo ec2-user@${aws_eip.demo.public_ip}"
}
