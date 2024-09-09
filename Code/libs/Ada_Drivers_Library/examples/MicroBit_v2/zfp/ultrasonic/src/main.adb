with MicroBit.Ultrasonic;
with MicroBit.Console; use MicroBit.Console;
with MicroBit.Time; use MicroBit.Time;
with MicroBit.Types; use MicroBit.Types;
use MicroBit;

procedure Main is
   package sensor1 is new Ultrasonic(MB_P16, MB_P0);
   package sensor2 is new Ultrasonic(MB_P15, MB_P0);
   package sensor3 is new Ultrasonic(MB_P14, MB_P0);

   Distance : Distance_cm := 0;
begin
   loop
      Put_Line ("");
      Distance := sensor1.Read;
      Put_Line ("Front: " & Distance_cm'Image(Distance)); -- a console line delay the loop significantly
      Distance := sensor2.Read;
      Put_Line ("Left: " & Distance_cm'Image(Distance)); -- a console line delay the loop significantly
      Distance := sensor3.Read;
      Put_Line ("Right: " & Distance_cm'Image(Distance)); -- a console line delay the loop significantly

      --NOTE:
      -- A delay directly after a read of about 50ms is needed since signal need to die out to be sure there is nothing
      -- With multiple sensors in different cardinal directions 50ms is fine since they dont overlap
      -- Smaller delays are possible but they will
      --    - Flood the serial port
      --    - A smaller delay is sometimes possible in situations where it can be guaranteed that no
      --      echo comes back later than the custom threshold (ie. echo's always come back).
      Delay_Ms(50);
   end loop;

end Main;



